// src/realtime/socket.js
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import { randomUUID } from "crypto";
import mongoose from "mongoose";
import Group from "../models/Group.js";
import User from "../models/User.js";

/** Shared start scheduled slightly in the future so all clients can start together */
const SCHEDULE_AHEAD_MS = 1500;

/** In-memory timers for auto-advance (single-process) */
const autoAdvanceTimers = new Map(); // Map<groupId, NodeJS.Timeout>
const keyOf = (id) => (typeof id === "string" ? id : String(id));

function clearAutoTimer(groupId) {
  const key = keyOf(groupId);
  const t = autoAdvanceTimers.get(key);
  if (t) clearTimeout(t);
  autoAdvanceTimers.delete(key);
}

/** Build consistent queue items array from legacy/new docs */
function getItemsArray(queue) {
  if (!queue) return [];
  if (Array.isArray(queue.items)) return queue.items;
  if (Array.isArray(queue.item)) return queue.item; // legacy
  return [];
}

// Normalize playback fields coming from DB (handles startoffsetSec vs startOffsetSec)
function normalizePlayback(p) {
  if (!p)
    return {
      trackUrl: null,
      isPlaying: false,
      startAtServerMs: 0,
      startOffsetSec: 0,
      updatedBy: null,
    };
  const startOffsetSec = Number(p.startOffsetSec ?? p.startoffsetSec ?? 0);
  const startAtServerMs = Number(p.startAtServerMs ?? 0);
  return { ...p, startOffsetSec, startAtServerMs };
}

function setItemsArray(queue, arr) {
  if (!queue) return;
  queue.items = arr;
  queue.item = arr; // keep legacy field in sync
}

/** Broadcast helpers */
async function broadcastQueue(io, groupId) {
  const g = await Group.findById(groupId).lean();
  if (!g) return;
  const items = getItemsArray(g.queue);
  io.to(`room:group:${keyOf(groupId)}`).emit("queue:state", {
    queue: {
      items,
      currentIndex: g.queue.currentIndex,
      version: g.queue.version,
    },
    serverNowMs: Date.now(),
  });
}

function nowStatePayload(group) {
  return { playback: group.playback, serverNowMs: Date.now() };
}

async function broadcastPlayback(io, groupId) {
  const g = await Group.findById(groupId).lean();
  if (!g) return;
  io.to(`room:group:${String(groupId)}`).emit("playback:state", {
    playback: g.playback,
    serverNowMs: Date.now(),
  });
}

/** Auto-advance timer including the "start in future" gap */
function scheduleAutoAdvance(io, group) {
  clearAutoTimer(group._id);

  const { playback, queue } = group;
  if (!playback?.isPlaying) return;

  const items = getItemsArray(queue);
  const current = items[queue.currentIndex];
  if (!current || !Number.isFinite(current.durationSec)) return;

  const startAt = Number(playback.startAtServerMs || 0);
  const now = Date.now();
  const aheadMs = Math.max(0, startAt - now); // future-start gap
  const startedMs = Math.max(0, now - startAt); // elapsed since scheduled start
  const offsetSec = Number(playback.startOffsetSec || 0);
  const elapsedSec = startedMs / 1000 + offsetSec;

  const remainingMs = Math.max(
    0,
    (current.durationSec - elapsedSec) * 1000 + aheadMs
  );

  const timer = setTimeout(async () => {
    try {
      await nextTrack(io, group._id, { reason: "auto" });
    } catch {}
  }, remainingMs + 50);

  autoAdvanceTimers.set(String(group._id), timer);
}

/** Permissions */
const isController = (group, userId) =>
  group?.admin?.toString() === userId.toString();
const canEnqueue = (group, userId) =>
  isController(group, userId) || group?.settings?.allowListenerEnqueue;

/** Linear next/prev selection */
function pickNextIndexLinear(queue) {
  const items = getItemsArray(queue);
  const ci = queue?.currentIndex ?? -1;
  if (!items.length) return -1;
  const next = ci + 1;
  return next < items.length ? next : -1;
}
function pickPrevIndexLinear(queue) {
  const ci = queue?.currentIndex ?? -1;
  if (ci <= 0) return 0;
  return ci - 1;
}

/** Playback transitions */
async function startPlaying(io, groupId, userId) {
  const group = await Group.findById(groupId);
  if (!group) throw new Error("Group not found");

  const items = getItemsArray(group.queue);
  if (group.queue.currentIndex === -1 && items.length > 0) {
    group.queue.currentIndex = 0;
  }
  const current = items[group.queue.currentIndex];
  if (!current) return;

  if (!group.playback) group.playback = {};
  group.playback.trackUrl = current.trackUrl;
  group.playback.isPlaying = true;
  group.playback.startOffsetSec = Number(group.playback.startOffsetSec || 0);
  group.playback.startAtServerMs = Date.now() + SCHEDULE_AHEAD_MS;
  group.playback.updatedBy = userId;

  await group.save();
  await broadcastPlayback(io, groupId);
}
async function pausePlaying(io, groupId, userId) {
  const group = await Group.findById(groupId);
  if (!group) throw new Error("Group not found");

  if (group.playback?.isPlaying) {
    const startedMs = Math.max(
      0,
      Date.now() - (group.playback.startAtServerMs || 0)
    );
    group.playback.startOffsetSec =
      Number(group.playback.startOffsetSec || 0) + startedMs / 1000;
  }
  group.playback.isPlaying = false;
  group.playback.startAtServerMs = 0;
  group.playback.updatedBy = userId;

  await group.save();
  clearAutoTimer(groupId);
  await broadcastPlayback(io, groupId);
}

async function nextTrack(io, groupId, { reason = "manual" } = {}) {
  const g = await Group.findById(groupId);
  if (!g) return;

  const items = Array.isArray(g.queue?.items) ? g.queue.items
              : Array.isArray(g.queue?.item)  ? g.queue.item : [];
  if (!items.length) {
    g.playback = { trackUrl: null, isPlaying: false, startAtServerMs: 0, startOffsetSec: 0 };
    await g.save();
    await broadcastPlayback(io, groupId);
    return;
  }

  const ci = Number.isInteger(g.queue.currentIndex) ? g.queue.currentIndex : -1;
  const ni = ci + 1 < items.length ? ci + 1 : -1;
  if (ni === -1) {
    g.playback.isPlaying = false;
    g.playback.startAtServerMs = 0;
    g.playback.startOffsetSec = 0;
    await g.save();
    await broadcastPlayback(io, groupId);
    return;
  }

  g.queue.currentIndex = ni;
  const cur = items[ni];

  g.playback.trackUrl       = cur.trackUrl;
  g.playback.isPlaying      = true;
  g.playback.startOffsetSec = 0;
  g.playback.startAtServerMs = Date.now() + SCHEDULE_AHEAD_MS;

  g.queue.version = Number(g.queue.version || 0) + 1;

  await g.save();
  await broadcastQueue(io, groupId);
  await broadcastPlayback(io, groupId);
}

async function prevTrack(io, groupId) {
  const g = await Group.findById(groupId);
  if (!g) return;

  const items = Array.isArray(g.queue?.items) ? g.queue.items
              : Array.isArray(g.queue?.item)  ? g.queue.item : [];
  if (!items.length) {
    g.playback = { trackUrl: null, isPlaying: false, startAtServerMs: 0, startOffsetSec: 0 };
    await g.save();
    await broadcastPlayback(io, groupId);
    return;
  }

  const ci = Number.isInteger(g.queue.currentIndex) ? g.queue.currentIndex : -1;
  const pi = Math.max(0, ci - 1);

  g.queue.currentIndex = pi;
  const cur = items[pi];

  g.playback.trackUrl       = cur.trackUrl;
  g.playback.isPlaying      = true;
  g.playback.startOffsetSec = 0;
  g.playback.startAtServerMs = Date.now() + SCHEDULE_AHEAD_MS;

  g.queue.version = Number(g.queue.version || 0) + 1;

  await g.save();
  await broadcastQueue(io, groupId);
  await broadcastPlayback(io, groupId);
}

/** Main initializer */
export function initSocket(httpServer) {
  const io = new Server(httpServer, { cors: { origin: "*" } });

  // Auth
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) return next(new Error("No token"));
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id).select("_id name");
      if (!user) return next(new Error("User not found"));
      socket.user = user;
      next();
    } catch (e) {
      next(e);
    }
  });

  io.on("connection", (socket) => {
    /* ---- Time sync (simple) ---- */
    socket.on("timesync:ping", (clientSentMs) => {
      socket.emit("timesync:pong", { clientSentMs, serverNowMs: Date.now() });
    });

    /* ---- Join group ---- */
    socket.on("group:join", async ({ groupId, groupCode }, ack) => {
      try {
        let group = null;
        if (groupId) {
          if (!mongoose.isValidObjectId(groupId)) {
            socket.emit("error", {
              code: "INVALID_GROUP_ID",
              message: `Invalid groupId: ${groupId}`,
            });
            ack?.({ ok: false, error: "INVALID_GROUP_ID" });
            return;
          }
          group = await Group.findById(groupId).select(
            "members queue playback admin settings"
          );
        } else if (groupCode) {
          group = await Group.findOne({ groupCode }).select(
            "members queue playback admin settings"
          );
          if (!group) {
            socket.emit("error", {
              code: "GROUP_NOT_FOUND",
              message: `No group for code ${groupCode}`,
            });
            ack?.({ ok: false, error: "GROUP_NOT_FOUND" });
            return;
          }
          groupId = group._id.toString();
        } else {
          socket.emit("error", {
            code: "MISSING_PARAM",
            message: "Provide groupId or groupCode",
          });
          ack?.({ ok: false, error: "MISSING_PARAM" });
          return;
        }

        const isMember = group.members?.some(
          (id) => id.toString() === socket.user._id.toString()
        );
        if (!isMember) {
          socket.emit("error", {
            code: "NOT_A_MEMBER",
            message: "This user is not a member of the group",
          });
          ack?.({ ok: false, error: "NOT_A_MEMBER" });
          return;
        }

        socket.join(`room:group:${String(groupId)}`);
        socket.data.groupId = String(groupId);
        socket.emit("joined", { groupId: String(groupId) });

        const items = getItemsArray(group.queue);
        socket.emit("queue:state", {
          queue: {
            items,
            currentIndex: group.queue?.currentIndex ?? -1,
            version: group.queue?.version ?? 0,
          },
          serverNowMs: Date.now(),
        });

        const pb = normalizePlayback(group.playback);
        socket.emit("playback:state", {
          playback: pb,
          serverNowMs: Date.now(),
        });

        ack?.({ ok: true, groupId: String(groupId) });
      } catch (e) {
        console.error("group:join error:", e);
        socket.emit("error", {
          code: "JOIN_EXCEPTION",
          message: "Join failed",
        });
        ack?.({ ok: false, error: "JOIN_EXCEPTION" });
      }
    });

    /* ---- Playback controls (admin) ---- */
    socket.on("playback:play", async ({ groupId }, ack) => {
      try {
        const gid = groupId || socket.data.groupId;
        const g = await Group.findById(gid);
        if (!g) return ack?.({ ok: false, error: "GROUP_NOT_FOUND" });
        if (!isController(g, socket.user._id))
          return ack?.({ ok: false, error: "NOT_ALLOWED" });

        const items = getItemsArray(g.queue) || [];
        let cur =
          Number.isInteger(g.queue?.currentIndex) && g.queue.currentIndex >= 0
            ? items[g.queue.currentIndex]
            : null;
        if (!cur && items.length) {
          const idx = items.findIndex((it) => !!it?.trackUrl);
          if (idx >= 0) {
            g.queue.currentIndex = idx;
            cur = items[idx];
          }
        }

        const pbPrev = normalizePlayback(g.playback);
        const chosenTrackUrl = cur?.trackUrl || pbPrev.trackUrl;
        if (!chosenTrackUrl) return ack?.({ ok: false, error: "NO_TRACK" });

        g.playback = {
          trackUrl: chosenTrackUrl,
          isPlaying: true,
          startOffsetSec: pbPrev.startOffsetSec || 0,
          startAtServerMs: Date.now() + SCHEDULE_AHEAD_MS,
          updatedBy: socket.user._id,
        };

        await g.save();
        await broadcastQueue(io, gid);
        await broadcastPlayback(io, gid);
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ ok: false, error: "SERVER_ERROR" });
      }
    });

    socket.on("playback:pause", async ({ groupId }, ack) => {
      try {
        const g = await Group.findById(groupId);
        if (!g) return ack?.({ ok: false, error: "GROUP_NOT_FOUND" });
        if (!isController(g, socket.user._id))
          return ack?.({ ok: false, error: "NOT_ALLOWED" });
        await pausePlaying(io, groupId, socket.user._id);
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false, error: "SERVER_ERROR" });
      }
    });

    socket.on("playback:seek", async ({ groupId, toSec }, ack) => {
      try {
        const g = await Group.findById(groupId);
        if (!g) return ack?.({ ok: false, error: "GROUP_NOT_FOUND" });
        if (!isController(g, socket.user._id))
          return ack?.({ ok: false, error: "NOT_ALLOWED" });

        const newOffset = Math.max(0, Number(toSec) || 0);
        g.playback.startOffsetSec = newOffset;

        // If playing, rebase the shared timeline to NOW (instantaneous across devices)
        // If paused, keep startAtServerMs at 0 so clients just display the new position.
        g.playback.startAtServerMs = g.playback.isPlaying ? Date.now() : 0;
        g.playback.updatedBy = socket.user._id;

        await g.save();
        await broadcastPlayback(io, groupId); // emits { playback, serverNowMs: Date.now() }
        ack?.({ ok: true });
      } catch (e) {
        ack?.({ ok: false, error: "SERVER_ERROR" });
      }
    });

    socket.on("playback:next", async ({ groupId }, ack) => {
      try {
        const gid = groupId || socket.data.groupId;
        const g = await Group.findById(gid);
        if (!g) return ack?.({ ok: false, error: "GROUP_NOT_FOUND" });
        if (!isController(g, socket.user._id))
          return ack?.({ ok: false, error: "NOT_ALLOWED" });

        await nextTrack(io, gid, { reason: "manual" });
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false, error: "SERVER_ERROR" });
      }
    });

    socket.on("playback:prev", async ({ groupId }, ack) => {
      try {
        const gid = groupId || socket.data.groupId;
        const g = await Group.findById(gid);
        if (!g) return ack?.({ ok: false, error: "GROUP_NOT_FOUND" });
        if (!isController(g, socket.user._id))
          return ack?.({ ok: false, error: "NOT_ALLOWED" });

        await prevTrack(io, gid);
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false, error: "SERVER_ERROR" });
      }
    });

    /* ---- Queue operations ---- */
    socket.on("queue:get", async ({ groupId }) => {
      try {
        await broadcastQueue(io, groupId);
      } catch {}
    });

    socket.on(
      "queue:enqueue",
      async ({ groupId, track, position = "tail", expectedVersion }, ack) => {
        try {
          const g = await Group.findById(groupId);
          if (!g) {
            ack?.({ ok: false, error: "GROUP_NOT_FOUND" });
            return;
          }
          if (!canEnqueue(g, socket.user._id)) {
            ack?.({ ok: false, error: "NOT_ALLOWED" });
            return;
          }

          if (!g.queue)
            g.queue = { items: [], item: [], currentIndex: -1, version: 0 };
          if (!Array.isArray(g.queue.items)) g.queue.items = [];
          if (!Array.isArray(g.queue.item)) g.queue.item = [];
          if (typeof g.queue.currentIndex !== "number")
            g.queue.currentIndex = -1;
          if (typeof g.queue.version !== "number") g.queue.version = 0;

          if (
            Number.isFinite(expectedVersion) &&
            expectedVersion !== g.queue.version
          ) {
            ack?.({
              ok: false,
              error: `version mismatch: expected ${expectedVersion}, got ${g.queue.version}`,
              latestVersion: g.queue.version,
            });
            return;
          }

          const item = {
            id: track?.id || randomUUID(),
            trackId: track?.trackId || null,
            trackUrl: track?.trackUrl,
            title: track?.title || "",
            artist: track?.artist || "",
            durationSec: Number.isFinite(track?.durationSec)
              ? track.durationSec
              : null,
            addedBy: socket.user._id,
            addedAt: new Date(),
            meta: track?.meta || {},
          };
          if (!item.trackUrl) {
            ack?.({ ok: false, error: "bad_request" });
            return;
          }

          const items = getItemsArray(g.queue);
          if (position === "next" && g.queue.currentIndex !== -1) {
            items.splice(g.queue.currentIndex + 1, 0, item);
          } else if (
            position &&
            typeof position === "object" &&
            Number.isInteger(position.index)
          ) {
            const idx = Math.max(0, Math.min(items.length, position.index));
            items.splice(idx, 0, item);
            if (idx <= g.queue.currentIndex) g.queue.currentIndex += 1;
          } else {
            items.push(item); // tail
          }
          setItemsArray(g.queue, items);
          g.queue.version += 1;

          await g.save();
          ack?.({ ok: true, version: g.queue.version });
          await broadcastQueue(io, groupId);
        } catch (e) {
          ack?.({ ok: false, error: "server_error" });
        }
      }
    );

    socket.on("queue:remove", async ({ groupId, id, expectedVersion }, ack) => {
      try {
        const g = await Group.findById(groupId);
        if (!g) return ack?.({ ok: false, error: "GROUP_NOT_FOUND" });
        if (!isController(g, socket.user._id))
          return ack?.({ ok: false, error: "NOT_ALLOWED" });

        if (
          Number.isFinite(expectedVersion) &&
          expectedVersion !== g.queue.version
        ) {
          return ack?.({
            ok: false,
            error: "VERSION_MISMATCH",
            latestVersion: g.queue.version,
          });
        }

        const items = getItemsArray(g.queue);
        const idx = items.findIndex((i) => i.id === id);
        if (idx === -1) return ack?.({ ok: false, error: "NOT_FOUND" });

        const removingCurrent = idx === g.queue.currentIndex;
        items.splice(idx, 1);
        setItemsArray(g.queue, items);

        if (idx < g.queue.currentIndex) g.queue.currentIndex -= 1;
        else if (!items.length) g.queue.currentIndex = -1;
        else if (g.queue.currentIndex >= items.length)
          g.queue.currentIndex = items.length - 1;

        g.queue.version += 1;
        await g.save();
        await broadcastQueue(io, groupId);

        if (removingCurrent) {
          if (g.playback?.isPlaying) {
            if (!items.length) {
              g.playback = {
                trackUrl: null,
                isPlaying: false,
                startAtServerMs: 0,
                startOffsetSec: 0,
              };
              await g.save();
              await broadcastPlayback(io, groupId);
            } else {
              await nextTrack(io, groupId, { reason: "removed_current" });
            }
          } else {
            const cur =
              g.queue.currentIndex !== -1 ? items[g.queue.currentIndex] : null;
            g.playback.trackUrl = cur ? cur.trackUrl : null;
            await g.save();
            await broadcastPlayback(io, groupId);
          }
        }
        ack?.({ ok: true });
      } catch {
        ack?.({ ok: false, error: "SERVER_ERROR" });
      }
    });

    socket.on(
      "queue:reorder",
      async ({ groupId, moves = [], expectedVersion }, ack) => {
        try {
          const g = await Group.findById(groupId);
          if (!g) return ack?.({ ok: false, error: "GROUP_NOT_FOUND" });
          if (!isController(g, socket.user._id))
            return ack?.({ ok: false, error: "NOT_ALLOWED" });

          if (
            Number.isFinite(expectedVersion) &&
            expectedVersion !== g.queue.version
          ) {
            return ack?.({
              ok: false,
              error: "VERSION_MISMATCH",
              latestVersion: g.queue.version,
            });
          }

          const items = getItemsArray(g.queue);
          const byId = new Map(items.map((it, ix) => [it.id, ix]));
          for (const mv of moves) {
            if (!mv || typeof mv.toIndex !== "number") continue;
            const from = byId.get(mv.id);
            if (from === undefined) continue;
            const [it] = items.splice(from, 1);
            const to = Math.max(0, Math.min(items.length, mv.toIndex));
            items.splice(to, 0, it);
            items.forEach((x, ix) => byId.set(x.id, ix));
          }
          setItemsArray(g.queue, items);

          if (g.queue.currentIndex !== -1) {
            const curUrl =
              g.playback?.trackUrl || items[g.queue.currentIndex]?.trackUrl;
            const newIdx = items.findIndex((i) => i.trackUrl === curUrl);
            g.queue.currentIndex = newIdx >= 0 ? newIdx : -1;
          }

          g.queue.version += 1;
          await g.save();
          await broadcastQueue(io, groupId);
          ack?.({ ok: true });
        } catch {
          ack?.({ ok: false, error: "SERVER_ERROR" });
        }
      }
    );

    socket.on(
      "queue:clear",
      async ({ groupId, mode = "upcoming", expectedVersion }, ack) => {
        try {
          const g = await Group.findById(groupId);
          if (!g) return ack?.({ ok: false, error: "GROUP_NOT_FOUND" });
          if (!isController(g, socket.user._id))
            return ack?.({ ok: false, error: "NOT_ALLOWED" });

          if (
            Number.isFinite(expectedVersion) &&
            expectedVersion !== g.queue.version
          ) {
            return ack?.({
              ok: false,
              error: "VERSION_MISMATCH",
              latestVersion: g.queue.version,
            });
          }

          if (mode === "all") {
            g.queue.items = [];
            g.queue.currentIndex = -1;
            g.playback = {
              trackUrl: null,
              isPlaying: false,
              startAtServerMs: 0,
              startOffsetSec: 0,
            };
            clearAutoTimer(groupId);
          } else {
            if (g.queue.currentIndex !== -1) {
              g.queue.items = g.queue.items.slice(0, g.queue.currentIndex + 1);
            } else {
              g.queue.items = [];
            }
          }

          g.queue.version += 1;
          await g.save();
          await broadcastQueue(io, groupId);
          await broadcastPlayback(io, groupId);
          ack?.({ ok: true });
        } catch {
          ack?.({ ok: false, error: "SERVER_ERROR" });
        }
      }
    );

    socket.on(
      "queue:replace",
      async (
        {
          groupId,
          items = [],
          startIndex = 0,
          autoplay = true,
          expectedVersion,
        },
        ack
      ) => {
        try {
          const g = await Group.findById(groupId);
          if (!g) {
            ack?.({ ok: false, error: "GROUP_NOT_FOUND" });
            return;
          }
          if (!isController(g, socket.user._id)) {
            ack?.({ ok: false, error: "NOT_ALLOWED" });
            return;
          }

          // ensure container
          if (!g.queue) g.queue = { items: [], currentIndex: -1, version: 0 };
          if (!Array.isArray(g.queue.items)) g.queue.items = [];
          if (typeof g.queue.currentIndex !== "number")
            g.queue.currentIndex = -1;
          if (typeof g.queue.version !== "number") g.queue.version = 0;

          const normalized = (Array.isArray(items) ? items : [])
            .map((t) => ({
              id: t.id || randomUUID(),
              trackId: t.trackId || null,
              trackUrl: t.trackUrl,
              title: t.title || "",
              artist: t.artist || "",
              durationSec: Number.isFinite(t.durationSec)
                ? t.durationSec
                : null,
              addedBy: socket.user._id,
              addedAt: new Date(),
              meta: t.meta || {},
            }))
            .filter((it) => !!it.trackUrl);

          g.queue.items = normalized;
          g.queue.currentIndex = normalized.length
            ? Math.min(
                Math.max(0, Number(startIndex) || 0),
                normalized.length - 1
              )
            : -1;

          g.queue.version += 1;

          if (!g.playback) g.playback = {};
          g.playback.trackUrl =
            g.queue.currentIndex !== -1
              ? g.queue.items[g.queue.currentIndex].trackUrl
              : null;
          g.playback.startOffsetSec = 0;
          g.playback.startAtServerMs = 0;
          g.playback.isPlaying = false;
          g.playback.updatedBy = socket.user._id;

          await g.save();
          await broadcastQueue(io, groupId);

          if (autoplay && g.queue.currentIndex !== -1) {
            await startPlaying(io, groupId, socket.user._id);
            ack?.({ ok: true, started: true });
          } else {
            await broadcastPlayback(io, groupId);
            ack?.({ ok: true, started: false });
          }
        } catch (e) {
          ack?.({ ok: false, error: "SERVER_ERROR" });
        }
      }
    );
  });

  return io;
}
