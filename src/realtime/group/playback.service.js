//src/realtime/group/playback.service.js

import Group from "../../models/Group.js";
import { getRedis } from "../../adapters/redis.client.js";
import { GroupRedisKeys, GroupRooms } from "./redis.keys.js";
import { GROUP_MUSIC } from "./config/groupmusic.config.js";

const redis = getRedis();

function nowMs() {
    return Date.now();
}

function toBoolNum(v) {
    return v ? 1 : 0;
}

function parseH(h) {
    if (!h || Object.keys(h).length === 0) return null;
    return {
        isPlaying: h.isPlaying === "1",
        startAtServerMs: Number(h.startAtServerMs || 0),
        startOffsetSec: Number(h.startOffsetSec || 0),
        queueIndex: Number(h.queueIndex ?? -1),
        updatedBy: h.updatedBy || null,
    };
}

//read playback from redis if not found build from mongo
export async function getPlayback(groupId) {
    const key = GroupRedisKeys.playback(groupId);
    const h = parseH(await redis.hgetall(key));
    if (h) return h;

    //fallback from mongo
    const doc = await Group.findById(groupId, { queue: 1, playback: 1 }).lean();
    if (!doc) throw new Error("NOT_FOUND: group");

    const idx = typeof doc.queue?.currentIndex === "number" ? doc.queue.currentIndex : -1;
    return { 
        isPlaying: !!doc.playback?.isPlaying,
        startAtServerMs: Number(doc.playback?.startAtServerMs || 0),
        startOffsetSec: Number(doc.playback?.startOffsetSec || doc.playback?.startOffsetSec || 0),
        queueIndex: idx,
        updatedBy: doc.playback?.updatedBy ? String(doc.playback.updatedBy) : null,
    };
}

async function setPlayback(groupId, state) {
    const key = GroupRedisKeys.playback(groupId);
    const payload = {
        isPlaying: toBoolNum(state.isPlaying),
        startAtServerMs: String(state.startAtServerMs || 0),
        startOffsetSec: String(state.startOffsetSec || 0),
        queueIndex: String(
            typeof state.queueIndex === "number" ? state.queueIndex : -1
        ),
    };

    if (state.updatedBy) payload.updatedBy = String(state.updatedBy);
    await redis.hset(key, payload);

    await redis.expire(key, 60 * 60 * 6); //6H
}

export function effectiveOffsetSec(state, atMs = nowMs()) {
    if (!state.playing) return state.startOffsetSec || 0;
    const deltaMs = Math.max(0, atMs - (state.startAtServerMs || 0));
    return (state.startOffsetSec || 0) + deltaMs / 1000;
}

async function ensurePointer(groupId) {
  const doc = await Group.findById(groupId, { queue: 1 }).lean();
  if (!doc) throw new Error("NOT_FOUND: group");

  // ✅ use plural "items" (fall back to "item" for legacy docs)
  const items = Array.isArray(doc.queue?.items)
    ? doc.queue.items
    : Array.isArray(doc.queue?.item)
    ? doc.queue.item
    : [];

  let idx =
    typeof doc.queue?.currentIndex === "number"
      ? doc.queue.currentIndex
      : -1;

  if (items.length === 0) return { ok: false, reason: "EMPTY_QUEUE" };

  if (idx < 0 || idx >= items.length) {
    await Group.updateOne(
      { _id: groupId },
      { $set: { "queue.currentIndex": 0 } }
    );
    idx = 0;
  }
  return { ok: true, idx, items };
}

export async function broadcastPlayback(nsp, groupId) {
    const room = GroupRooms.group(groupId);
    const state = await getPlayback(groupId);
    nsp.to(room).emit("v1:playback:state", {
        groupId,
        isPlaying: state.isPlaying,
        startAtServerMs: state.startAtServerMs,
        startOffsetSec: state.startOffsetSec,
        queueIndex: state.queueIndex,
        serverNowMs: nowMs(),
    });
}

export async function startPlayback(nsp, groupId, userId, opts = {}) {
    const { ok, idx, items, reason } = await ensurePointer(groupId);
    if (!ok) return { ok: false, code: reason, message: "Queue is empty" };

    const scheduleAt = nowMs() + GROUP_MUSIC.SCHEDULE_AHEAD_MS;
    const startOffsetSec = typeof opts.startOffsetSec === "number" ? Math.max(0, opts.startOffsetSec) : 0;

    await setPlayback(groupId, {
        isPlaying: true,
        startAtServerMs: scheduleAt,
        startOffsetSec,
        queueIndex: idx,
        updatedBy: userId,
    });

    await Group.updateOne(
        { _id: groupId },
        {
            $set: {
                "playback.isPlaying": true,
                "playback.startAtServerMs": scheduleAt,
                "playback.startOffsetSec": startOffsetSec,
                "playback.updatedBy": userId,
            },
        }
    );

    await broadcastPlayback(nsp, groupId);

    const current = items[idx];
    return{ ok: true, currentIndex: idx, current };
}

export async function pausePlayback(nsp, groupId, userId) {
    const st = await getPlayback(groupId);
    const offset = effectiveOffsetSec(st, nowMs());

    await setPlayback(groupId, {
        isPlaying: false,
        startAtServerMs: 0,
        startOffsetSec: offset,
        queueIndex: st.queueIndex,
        updatedBy: userId,
    });

    await Group.updateOne(
        { _id: groupId },
        {
            $set: {
                "playback.isPlaying": false,
                "playback.startAtServerMs": 0,
                "playback.startOffsetSec": offset,
                "playback.updatedBy": userId,
            },
        }
    );

    await broadcastPlayback(nsp, groupId);
    return { ok: true, offsetSec: offset };
}

export async function seekPlayback(nsp, groupId, userId, offsetSec) {
    const st = await getPlayback(groupId);
    const scheduleAt = st.isPlaying ? nowMs() + GROUP_MUSIC.SCHEDULE_AHEAD_MS : 0;

    await setPlayback(groupId, {
        isPlaying: st.isPlaying,
        startAtServerMs: scheduleAt,
        startOffsetSec: Math.max(0, Number(offsetSec || 0)),
        queueIndex: st.queueIndex,
        updatedBy: userId,
    });

    await Group.updateOne(
        { _id: groupId },
        {
            $set: {
                "playback.isPlaying": st.isPlaying,
                "playback.startAtServerMs": scheduleAt,
                "playback.startOffsetSec": Math.max(0, Number(offsetSec || 0)),
                "playback.updatedBy": userId,
            },
        }
    );
    
    await broadcastPlayback(nsp, groupId);
    return  { ok: true };
}

export async function stepPlayback(nsp, groupId, userId, dir = +1) {
    const doc = await Group.findById(groupId, { queue: 1 }).lean();
    if (!doc) return { ok: false, code: "NOT_FOUND" };

    const items = doc.queue?.item || [];
    if (items.length === 0) return { ok: false, code: "EMPTY_QUEUE" };

    const cur = typeof doc.queue.currentIndex === "number" ? doc.queue.currentIndex : -1;
    let nextIdx = cur + dir;
    if (nextIdx < 0) nextIdx = 0;
    if (nextIdx >= items.length) nextIdx = items.length - 1;

    if (nextIdx !== cur) {
        await Group.updateOne(
            { _id: groupId },
            {
                $set: { "queue.currentIndex": nextIdx },
                $inc: { "queue.version": 1 },
            }
        );
    }

    const scheduleAt = nowMs() + GROUP_MUSIC.SCHEDULE_AHEAD_MS;
    await setPlayback(groupId, {
        isPlaying: true,
        startAtServerMs: scheduleAt,
        startOffsetSec: 0,
        queueIndex: nextIdx,
        updatedBy: userId,
    });

    await Group.updateOne(
        { _id: groupId },
        {
            $set: {
                "playback.isPlaying": true,
                "playback.startAtServerMs": scheduleAt,
                "playback.startOffsetSec": 0,
                "playback.updatedBy": userId,
            },
        }
    );
    
    await broadcastPlayback(nsp, groupId);
    return { ok: true, currentIndex: nextIdx };
}
