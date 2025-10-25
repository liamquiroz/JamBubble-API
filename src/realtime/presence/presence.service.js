// src/realtime/presence/presence.service.js
import { getRedis } from "../../adapters/redis.client.js";
import { PRESENCE_KEYS } from "./presence.constants.js";
import { PRESENCE } from "../presence/presence.config.js";

const redis = getRedis();

// In-process grace timers (per instance). Fine for now; can move to Redis later if needed.
const graceTimers = new Map(); // key = `${userId}:${deviceId}` -> timeout

function now() { return Date.now(); }

function keyFor(u, d) { return `${u}:${d}`; }

/** Mark device online, attach socketId, and update user aggregate (idempotent). */
export async function markOnline(userId, deviceId, socketId) {
  const kSock = PRESENCE_KEYS.socket(socketId);
  const kDev = PRESENCE_KEYS.deviceHash(userId, deviceId);
  const kDevSet = PRESENCE_KEYS.deviceSockets(userId, deviceId);
  const kUser = PRESENCE_KEYS.userHash(userId);

  const t = now();

  // Save reverse pointer (helps sweeper/cleanup)
  await redis.set(kSock, `${userId}|${deviceId}`, "EX", 60 * 60 * 6); // 6h just as a soft TTL

  // Was device previously online?
  const prevOnline = (await redis.hget(kDev, "online")) === "1";

  // Attach socket to device
  await redis.sadd(kDevSet, socketId);

  // Mark device online
  await redis.hset(kDev, { online: 1, lastSeenMs: t });

  // If device transitions 0->1, bump user.devicesOnline
  if (!prevOnline) {
    const devicesOnline = await redis.hincrby(kUser, "devicesOnline", 1);
    // If user was previously offline, flip online
    if (devicesOnline === 1) {
      await redis.hset(kUser, { online: 1, lastSeenMs: t });
    }
  } else {
    // keep lastSeen fresh
    await redis.hset(kUser, { lastSeenMs: t });
  }

  return getUserPresence(userId);
}

/** Begin grace period; if no reconnect, finalize offline for device/socket. */
export function beginGrace(userId, deviceId, socketId) {
  const id = keyFor(userId, deviceId);
  // Clear any existing
  const existing = graceTimers.get(id);
  if (existing) clearTimeout(existing);

  const to = setTimeout(() => {
    finalizeOffline(userId, deviceId, socketId).catch((e) =>
      console.error("[presence] finalizeOffline error:", e.message)
    );
    graceTimers.delete(id);
  }, PRESENCE.GRACE_MS);

  graceTimers.set(id, to);
}

/** Cancel grace (device reconnected). */
export function cancelGrace(userId, deviceId) {
  const id = keyFor(userId, deviceId);
  const t = graceTimers.get(id);
  if (t) {
    clearTimeout(t);
    graceTimers.delete(id);
  }
}

/** Finalize offline for a device (if no sockets remain), update user aggregate. */
export async function finalizeOffline(userId, deviceId, socketIdToRemove) {
  const kSock = socketIdToRemove ? PRESENCE_KEYS.socket(socketIdToRemove) : null;
  const kDev = PRESENCE_KEYS.deviceHash(userId, deviceId);
  const kDevSet = PRESENCE_KEYS.deviceSockets(userId, deviceId);
  const kUser = PRESENCE_KEYS.userHash(userId);

  if (socketIdToRemove) {
    await redis.del(kSock).catch(() => {});
    await redis.srem(kDevSet, socketIdToRemove);
  }

  const remaining = await redis.scard(kDevSet);

  if (remaining > 0) {
    // Device still has sockets; keep it online.
    return getUserPresence(userId);
  }

  const t = now();

  // Mark device offline and update lastSeen
  await redis.hset(kDev, { online: 0, lastSeenMs: t });

  // Decrement user's devicesOnline (not below zero)
  let devicesOnline = Number(await redis.hget(kUser, "devicesOnline"));
  if (Number.isNaN(devicesOnline)) devicesOnline = 0;
  devicesOnline = Math.max(0, devicesOnline - 1);
  await redis.hset(kUser, { devicesOnline });

  if (devicesOnline === 0) {
    await redis.hset(kUser, { online: 0, lastSeenMs: t });
  }

  return getUserPresence(userId);
}

/** Read aggregated user presence. */
export async function getUserPresence(userId) {
  const kUser = PRESENCE_KEYS.userHash(userId);
  const raw = await redis.hgetall(kUser);
  return {
    userId,
    online: raw.online === "1",
    devicesOnline: Number(raw.devicesOnline || 0),
    lastSeenMs: Number(raw.lastSeenMs || 0),
  };
}

/** Sweeper: mark devices offline if they have no sockets but still online, or stale. */
export async function sweepPresence(logger = console) {
  // NOTE: SCAN is used to avoid blocking Redis; pattern match device hashes.
  // Keys: presence:device:<userId>:<deviceId>
  const pattern = "presence:device:*";
  let cursor = "0";
  let processed = 0;
  let offlined = 0;

  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 500);
    cursor = next;

    for (const kDev of keys) {
      processed++;
      const parts = kDev.split(":"); // [presence, device, <uid>, <did>]
      const userId = parts[2];
      const deviceId = parts[3];
      const kDevSet = PRESENCE_KEYS.deviceSockets(userId, deviceId);

      const [onlineStr, lastSeenStr, socketsCount] = await redis
        .multi()
        .hget(kDev, "online")
        .hget(kDev, "lastSeenMs")
        .scard(kDevSet)
        .exec()
        .then(results => results.map(r => r[1]));

      const online = onlineStr === "1";
      const lastSeen = Number(lastSeenStr || 0);
      const stale = lastSeen && now() - lastSeen > PRESENCE.STALE_MS;

      if ((online && socketsCount === 0) || stale) {
        await finalizeOffline(userId, deviceId);
        offlined++;
      }
    }
  } while (cursor !== "0");

  //logger.info?.(`[presence] sweep processed=${processed} offlined=${offlined}`);
  return { processed, offlined };
}
