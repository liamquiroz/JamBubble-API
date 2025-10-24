// src/realtime/group/group.controller.js
import Group from "../../models/Group.js";
import { ensureGroupMember, ensureGroupController } from "./group.guard.js";
import { GroupRedisKeys, GroupRooms } from "./redis.keys.js";
import { getRedis } from "../../adapters/redis.client.js";
import { GROUP_MUSIC } from "../group/config/groupmusic.config.js";

// Playback
import {
  startPlayback,
  pausePlayback,
  seekPlayback,
  stepPlayback,
} from "./playback.service.js";

// Queue
import {
  appendItems,
  removeItem,
  moveItem,
  clearQueue,
  broadcastQueue,
} from "./queue.service.js";

// Requests
import {
  submitRequest,
  approveRequest,
  rejectRequest,
} from "./requests.service.js";

const redis = getRedis();

// Event constants (v1, normalized)
export const EVT = {
  GROUP_JOIN: "v1:group:join",
  STATE_GET: "v1:state:get",

  LISTEN_JOIN: "v1:listening:join",
  LISTEN_LEAVE: "v1:listening:leave",
  LISTEN_UPDATE: "v1:listening:update",

  PB_START: "v1:playback:start",
  PB_PAUSE: "v1:playback:pause",
  PB_SEEK: "v1:playback:seek",
  PB_NEXT: "v1:playback:next",
  PB_PREV: "v1:playback:prev",

  Q_APPEND: "v1:queue:append",
  Q_REMOVE: "v1:queue:remove",
  Q_MOVE: "v1:queue:move",
  Q_CLEAR: "v1:queue:clear",

  REQ_SUBMIT: "v1:request:submit",
  REQ_APPROVE: "v1:request:approve",
  REQ_REJECT: "v1:request:reject",

  PB_STATE: "v1:playback:state",
  Q_STATE: "v1:queue:state",
};

// Safe ACK helper
function ackify(cb, payload) {
  if (typeof cb === "function") {
    try { cb(payload); } catch (err) {
      console.error("[group.controller] ACK callback error:", err);
    }
  }
}

// Build state (fix default queue shape: items[])
async function buildGroupState(groupId, isAdminView = false) {
  const doc = await Group.findById(groupId, {
    queue: 1,
    playback: 1,
    controllerUserId: 1,
    requests: isAdminView ? 1 : { $slice: 0 },
  }).lean();

  if (!doc) throw new Error("NOT_FOUND: group");

  // Redis playback merge (unchanged)
  const rKey = GroupRedisKeys.playback(groupId);
  const rState = await redis.hgetall(rKey);

  let playback = doc.playback || {};
  if (rState && Object.keys(rState).length) {
    playback = {
      isPlaying: rState.isPlaying === "1",
      startAtServerMs: Number(rState.startAtServerMs || 0),
      startOffsetSec: Number(rState.startOffsetSec || 0),
      queueIndex: Number(rState.queueIndex ?? doc.queue?.currentIndex ?? -1),
      updatedBy: doc.playback?.updatedBy || null,
    };
  }

  // ✅ Normalize queue shape
  const q = doc.queue || {};
  const items = Array.isArray(q.items)
    ? q.items
    : Array.isArray(q.item)
    ? q.item
    : [];
  const queue = {
    items,
    currentIndex: typeof q.currentIndex === "number" ? q.currentIndex : -1,
    version: typeof q.version === "number" ? q.version : 0,
  };

  return {
    queue,
    playback,
    controllerUserId: doc.controllerUserId ? String(doc.controllerUserId) : null,
    serverNowMs: Date.now(),
    ...(isAdminView ? { requests: doc.requests || { items: [] } } : {}),
  };
}

export function attachGroupHandlers(nsp, socket) {
  const userId = String(socket.data?.user?._id || "");

  socket.on(EVT.GROUP_JOIN, async (payload = {}, cb) => {
    try {
      const { groupId } = payload;
      if (!groupId) throw new Error("BAD_REQUEST: groupId required");

      await ensureGroupMember(socket, groupId);
      socket.join(GroupRooms.group(groupId));
      socket.join(GroupRooms.user(userId));

      ackify(cb, { ok: true });
    } catch (e) {
      ackify(cb, { ok: false, message: e.message });
    }
  });

  socket.on(EVT.STATE_GET, async (payload = {}, cb) => {
    try {
      const { groupId } = payload;
      if (!groupId) throw new Error("BAD_REQUEST: groupId required");

      const ctx = await ensureGroupMember(socket, groupId);
      const state = await buildGroupState(groupId, ctx.isAdmin);
      ackify(cb, { ok: true, ...state });
    } catch (e) {
      ackify(cb, { ok: false, message: e.message });
    }
  });

  socket.on(EVT.LISTEN_JOIN, async (payload = {}, cb) => {
    try {
      const { groupId } = payload;
      if (!groupId) throw new Error("BAD_REQUEST: groupId required");

      await ensureGroupMember(socket, groupId);
      await redis.sadd(GroupRedisKeys.listenersSet(groupId), userId);

      if (GROUP_MUSIC.LISTENERS_BROADCASTS) {
        const listeners = await redis.smembers(GroupRedisKeys.listenersSet(groupId));
        nsp.to(GroupRooms.group(groupId)).emit(EVT.LISTEN_UPDATE, {
          groupId, listeners, count: listeners.length,
        });
      }

      ackify(cb, { ok: true });
    } catch (e) {
      ackify(cb, { ok: false, message: e.message });
    }
  });

  socket.on(EVT.LISTEN_LEAVE, async (payload = {}, cb) => {
    try {
      const { groupId } = payload;
      if (!groupId) throw new Error("BAD_REQUEST: groupId required");

      await ensureGroupMember(socket, groupId);
      await redis.srem(GroupRedisKeys.listenersSet(groupId), userId);

      if (GROUP_MUSIC.LISTENERS_BROADCASTS) {
        const listeners = await redis.smembers(GroupRedisKeys.listenersSet(groupId));
        nsp.to(GroupRooms.group(groupId)).emit(EVT.LISTEN_UPDATE, {
          groupId, listeners, count: listeners.length,
        });
      }

      ackify(cb, { ok: true });
    } catch (e) {
      ackify(cb, { ok: false, message: e.message });
    }
  });

  // ───────── Playback ─────────

  socket.on(EVT.PB_START, async (payload = {}, cb) => {
    try {
      const { groupId, startOffsetSec } = payload;
      if (!groupId) throw new Error("BAD_REQUEST: groupId required");
      await ensureGroupController(socket, groupId);

      const res = await startPlayback(nsp, groupId, userId, { startOffsetSec });
      if (!res.ok) return ackify(cb, { ok: false, code: res.code, message: res.message });

      ackify(cb, { ok: true, currentIndex: res.currentIndex });
    } catch (e) {
      ackify(cb, { ok: false, message: e.message });
    }
  });

  socket.on(EVT.PB_PAUSE, async (payload = {}, cb) => {
    try {
      const { groupId } = payload;
      if (!groupId) throw new Error("BAD_REQUEST: groupId required");
      await ensureGroupController(socket, groupId);

      const res = await pausePlayback(nsp, groupId, userId);
      ackify(cb, { ok: true, offsetSec: res.offsetSec });
    } catch (e) {
      ackify(cb, { ok: false, message: e.message });
    }
  });

  socket.on(EVT.PB_SEEK, async (payload = {}, cb) => {
    try {
      const { groupId, offsetSec } = payload;
      if (!groupId || typeof offsetSec !== "number")
        throw new Error("BAD_REQUEST: groupId and offsetSec required");

      await ensureGroupController(socket, groupId);

      const coolKey = GroupRedisKeys.seekCooldown(groupId, userId);
      const ttl = await redis.ttl(coolKey);
      if (ttl > 0)
        return ackify(cb, { ok: false, code: "COOLDOWN", retryInSec: ttl });

      await seekPlayback(nsp, groupId, userId, offsetSec);
      await redis.set(coolKey, "1", "EX", Math.ceil(GROUP_MUSIC.SEEK_COOLDOWN_MS / 1000));

      ackify(cb, { ok: true });
    } catch (e) {
      ackify(cb, { ok: false, message: e.message });
    }
  });

  socket.on(EVT.PB_NEXT, async (payload = {}, cb) => {
    try {
      const { groupId } = payload;
      if (!groupId) throw new Error("BAD_REQUEST: groupId required");
      await ensureGroupController(socket, groupId);

      const res = await stepPlayback(nsp, groupId, userId, +1);
      if (!res.ok) return ackify(cb, { ok: false, code: res.code });

      ackify(cb, { ok: true, currentIndex: res.currentIndex });
    } catch (e) {
      ackify(cb, { ok: false, message: e.message });
    }
  });

  socket.on(EVT.PB_PREV, async (payload = {}, cb) => {
    try {
      const { groupId } = payload;
      if (!groupId) throw new Error("BAD_REQUEST: groupId required");
      await ensureGroupController(socket, groupId);

      const res = await stepPlayback(nsp, groupId, userId, -1);
      if (!res.ok) return ackify(cb, { ok: false, code: res.code });

      ackify(cb, { ok: true, currentIndex: res.currentIndex });
    } catch (e) {
      ackify(cb, { ok: false, message: e.message });
    }
  });

  // ───────── Queue ─────────

  socket.on(EVT.Q_APPEND, async (payload = {}, cb) => {
    try {
      const { groupId, baseVersion } = payload;

      // Normalize: accept items[] OR item
      const items =
        Array.isArray(payload.items) ? payload.items
        : payload.item ? [payload.item]
        : null;

      if (!groupId || typeof baseVersion !== "number" || !Array.isArray(items))
        throw new Error("BAD_REQUEST: groupId, baseVersion, items[] required");

      await ensureGroupController(socket, groupId);

      const res = await appendItems(nsp, groupId, userId, baseVersion, items);
      if (!res.ok) return ackify(cb, { ok: false, ...res });

      ackify(cb, { ok: true, version: res.version });
    } catch (e) {
      ackify(cb, { ok: false, message: e.message });
    }
  });

  socket.on(EVT.Q_REMOVE, async (payload = {}, cb) => {
    try {
      const { groupId, baseVersion, itemId } = payload;
      if (!groupId || typeof baseVersion !== "number" || !itemId)
        throw new Error("BAD_REQUEST: groupId, baseVersion, itemId required");

      await ensureGroupController(socket, groupId);

      const res = await removeItem(nsp, groupId, userId, baseVersion, itemId);
      if (!res.ok) return ackify(cb, { ok: false, ...res });

      ackify(cb, { ok: true, version: res.version, currentIndex: res.currentIndex });
    } catch (e) {
      ackify(cb, { ok: false, message: e.message });
    }
  });

  socket.on(EVT.Q_MOVE, async (payload = {}, cb) => {
    try {
      const { groupId, baseVersion, itemId, toIndex } = payload;
      if (!groupId || typeof baseVersion !== "number" || !itemId || typeof toIndex !== "number")
        throw new Error("BAD_REQUEST: groupId, baseVersion, itemId, toIndex required");

      await ensureGroupController(socket, groupId);

      const res = await moveItem(nsp, groupId, userId, baseVersion, itemId, toIndex);
      if (!res.ok) return ackify(cb, { ok: false, ...res });

      ackify(cb, { ok: true, version: res.version, currentIndex: res.currentIndex });
    } catch (e) {
      ackify(cb, { ok: false, message: e.message });
    }
  });

  socket.on(EVT.Q_CLEAR, async (payload = {}, cb) => {
    try {
      const { groupId, baseVersion } = payload;
      if (!groupId || typeof baseVersion !== "number")
        throw new Error("BAD_REQUEST: groupId & baseVersion required");

      await ensureGroupController(socket, groupId);

      const res = await clearQueue(nsp, groupId, userId, baseVersion);
      if (!res.ok) return ackify(cb, { ok: false, ...res });

      ackify(cb, { ok: true, version: res.version });
    } catch (e) {
      ackify(cb, { ok: false, message: e.message });
    }
  });

  // ───────── Requests ─────────

  socket.on(EVT.REQ_SUBMIT, async (payload = {}, cb) => {
    try {
      const { groupId, track } = payload;
      if (!groupId || !track)
        throw new Error("BAD_REQUEST: groupId & track required");

      await ensureGroupMember(socket, groupId);

      const res = await submitRequest(nsp, redis, groupId, userId, track);
      if (!res.ok) return ackify(cb, { ok: false, ...res });

      ackify(cb, { ok: true, requestId: res.requestId });
    } catch (e) {
      ackify(cb, { ok: false, message: e.message });
    }
  });

  socket.on(EVT.REQ_APPROVE, async (payload = {}, cb) => {
    try {
      const { groupId, requestId } = payload;
      if (!groupId || !requestId)
        throw new Error("BAD_REQUEST: groupId & requestId required");

      await ensureGroupController(socket, groupId);

      const res = await approveRequest(nsp, groupId, userId, requestId);
      if (!res.ok) return ackify(cb, { ok: false, ...res });

      ackify(cb, { ok: true, version: res.version, addedItemId: res.addedItemId });
    } catch (e) {
      ackify(cb, { ok: false, message: e.message });
    }
  });

  socket.on(EVT.REQ_REJECT, async (payload = {}, cb) => {
    try {
      const { groupId, requestId, reason } = payload;
      if (!groupId || !requestId)
        throw new Error("BAD_REQUEST: groupId & requestId required");

      await ensureGroupController(socket, groupId);

      const res = await rejectRequest(nsp, groupId, userId, requestId, reason);
      if (!res.ok) return ackify(cb, { ok: false, ...res });

      ackify(cb, { ok: true });
    } catch (e) {
      ackify(cb, { ok: false, message: e.message });
    }
  });
}
