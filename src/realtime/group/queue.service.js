// src/realtime/group/queue.service.js

import Group from "../../models/Group.js";
import { GroupRooms } from "./redis.keys.js";
import { GROUP_MUSIC } from "./config/groupmusic.config.js";

function nowMs() {
  return Date.now();
}

/**
 * Always use plural "items" for queue arrays.
 */
export async function getQueueState(groupId) {
  const doc = await Group.findById(groupId, { queue: 1 }).lean();
  if (!doc) throw new Error("NOT_FOUND: group");
  const q = doc.queue || {};
  return {
    items: Array.isArray(q.items) ? q.items : Array.isArray(q.item) ? q.item : [],
    currentIndex: typeof q.currentIndex === "number" ? q.currentIndex : -1,
    version: typeof q.version === "number" ? q.version : 0,
  };
}

export async function broadcastQueue(nsp, groupId) {
  const room = GroupRooms.group(groupId);
  const { items, currentIndex, version } = await getQueueState(groupId);
  nsp.to(room).emit("v1:queue:state", {
    groupId,
    queue: { items, currentIndex, version },
    serverNowMs: nowMs(),
  });
}

/**
 * Append new items to queue (versioned).
 */
export async function appendItems(nsp, groupId, userId, baseVersion, items) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, code: "EMPTY_APPEND" };
  }

  const { items: curItems, version: ver } = await getQueueState(groupId);
  if (baseVersion !== ver)
    return { ok: false, code: "CONFLICT", serverVersion: ver };

  const finalLen = curItems.length + items.length;
  if (finalLen > GROUP_MUSIC.MAX_QUEUE_ITEMS) {
    return {
      ok: false,
      code: "MAX_QUEUE_ITEMS",
      limit: GROUP_MUSIC.MAX_QUEUE_ITEMS,
    };
  }

  const res = await Group.findOneAndUpdate(
    { _id: groupId, "queue.version": baseVersion },
    {
      $push: { "queue.items": { $each: items } },
      $inc: { "queue.version": 1 },
    },
    { new: true, projection: { queue: 1 } }
  ).lean();

  if (!res) {
    const latest = await getQueueState(groupId);
    return { ok: false, code: "CONFLICT", serverVersion: latest.version };
  }

  await broadcastQueue(nsp, groupId);
  return { ok: true, version: res.queue.version };
}

/**
 * Remove an item by ID.
 */
export async function removeItem(nsp, groupId, userId, baseVersion, itemId) {
  const doc = await Group.findById(groupId, { queue: 1 }).lean();
  if (!doc) return { ok: false, code: "NOT_FOUND" };

  const q = doc.queue || {};
  const items = Array.isArray(q.items) ? q.items.slice() : Array.isArray(q.item) ? q.item.slice() : [];
  const version = typeof q.version === "number" ? q.version : 0;
  let currentIndex = typeof q.currentIndex === "number" ? q.currentIndex : -1;

  if (baseVersion !== version) {
    return { ok: false, code: "CONFLICT", serverVersion: version };
  }

  const idx = items.findIndex((x) => x.id === itemId);
  if (idx === -1) return { ok: false, code: "NOT_FOUND_ITEM" };

  items.splice(idx, 1);

  if (currentIndex > idx) currentIndex -= 1;
  if (items.length === 0) currentIndex = -1;
  else currentIndex = Math.min(currentIndex, items.length - 1);

  const res = await Group.findOneAndUpdate(
    { _id: groupId, "queue.version": baseVersion },
    {
      $set: { "queue.items": items, "queue.currentIndex": currentIndex },
      $inc: { "queue.version": 1 },
    },
    { new: true, projection: { queue: 1 } }
  ).lean();

  if (!res) {
    const latest = await getQueueState(groupId);
    return { ok: false, code: "CONFLICT", serverVersion: latest.version };
  }

  await broadcastQueue(nsp, groupId);
  return { ok: true, version: res.queue.version, currentIndex };
}

/**
 * Move an item inside the queue.
 */
export async function moveItem(nsp, groupId, userId, baseVersion, itemId, toIndex) {
  const doc = await Group.findById(groupId, { queue: 1 }).lean();
  if (!doc) return { ok: false, code: "NOT_FOUND" };

  const q = doc.queue || {};
  const items = Array.isArray(q.items) ? q.items.slice() : Array.isArray(q.item) ? q.item.slice() : [];
  const version = typeof q.version === "number" ? q.version : 0;
  let currentIndex = typeof q.currentIndex === "number" ? q.currentIndex : -1;

  if (baseVersion !== version) {
    return { ok: false, code: "CONFLICT", serverVersion: version };
  }

  if (items.length === 0) return { ok: false, code: "EMPTY_QUEUE" };

  const from = items.findIndex((x) => x.id === itemId);
  if (from === -1) return { ok: false, code: "NOT_FOUND_ITEM" };

  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));
  const to = clamp(Number(toIndex), 0, items.length - 1);
  if (from === to) return { ok: true, version };

  const [moved] = items.splice(from, 1);
  items.splice(to, 0, moved);

  if (currentIndex === from) currentIndex = to;
  else if (from < currentIndex && to >= currentIndex) currentIndex -= 1;
  else if (from > currentIndex && to <= currentIndex) currentIndex += 1;

  const res = await Group.findOneAndUpdate(
    { _id: groupId, "queue.version": baseVersion },
    {
      $set: { "queue.items": items, "queue.currentIndex": currentIndex },
      $inc: { "queue.version": 1 },
    },
    { new: true, projection: { queue: 1 } }
  ).lean();

  if (!res) {
    const latest = await getQueueState(groupId);
    return { ok: false, code: "CONFLICT", serverVersion: latest.version };
  }

  await broadcastQueue(nsp, groupId);
  return { ok: true, version: res.queue.version, currentIndex };
}

/**
 * Clear queue entirely.
 */
export async function clearQueue(nsp, groupId, userId, baseVersion) {
  const doc = await Group.findById(groupId, { queue: 1 }).lean();
  if (!doc) return { ok: false, code: "NOT_FOUND" };

  const version = typeof doc.queue?.version === "number" ? doc.queue.version : 0;
  if (baseVersion !== version) {
    return { ok: false, code: "CONFLICT", serverVersion: version };
  }

  const res = await Group.findOneAndUpdate(
    { _id: groupId, "queue.version": baseVersion },
    {
      $set: { "queue.items": [], "queue.currentIndex": -1 },
      $inc: { "queue.version": 1 },
    },
    { new: true, projection: { queue: 1 } }
  ).lean();

  if (!res) return { ok: false, code: "UPDATE_FAILED" };

  await broadcastQueue(nsp, groupId);
  return { ok: true, version: res.queue.version };
}
