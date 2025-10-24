// src/realtime/presence/presence.controller.js
import { EVENTS } from "./presence.constants.js";
import {
  markOnline,
  beginGrace,
  cancelGrace,
  finalizeOffline,
  getUserPresence,
} from "./presence.service.js";
import { PRESENCE } from "./presence.config.js";

/**
 * Attach presence event handlers to a connected socket.
 * Requires presence.guard to have populated:
 *   - socket.data.user._id
 *   - socket.data.deviceId
 */
export function presence(nsp, socket) {
  const userId = socket.data?.user?._id;
  const deviceId = socket.data?.deviceId;

  // Always ACK safely
  const ack = (cb, payload) => {
    if (typeof cb === "function") {
      try { cb(payload); } catch (err) {
        console.error("[presence] ACK callback error:", err?.message || err);
      }
    }
  };

  if (!userId || !deviceId) {
    console.warn("[presence] Missing user/deviceId → disconnecting");
    ack(() => {}, {
      ok: false,
      code: "AUTH_MISSING",
      message: "userId or deviceId missing in socket.data",
    });
    socket.disconnect(true);
    return;
  }

  // Client says "I'm here" (on connect or manual retry)
  socket.on(EVENTS.HELLO, async (payload = {}, cb) => {
    try {
      const groupId = payload?.groupId || payload?.roomId || null;

      cancelGrace(userId, deviceId, socket.id);
      await markOnline(userId, deviceId, socket.id);

      // Join group if provided, else a user-scoped room
      if (groupId) {
        await socket.join(`group:${groupId}`);
      } else {
        await socket.join(`user:${userId}`);
        console.warn("[presence] HELLO missing groupId (tolerated; joined user room)");
      }

      // Optional broadcast
      if (PRESENCE.BROADCASTS) {
        try {
          const s = await getUserPresence(userId);
          const room = groupId ? `group:${groupId}` : `user:${userId}`;
          nsp.to(room).emit(EVENTS.UPDATE, {
            userId,
            online: s.online,
            lastSeenMs: s.lastSeenMs,
          });
        } catch (e) {
          console.warn("[presence] broadcast error:", e?.message || e);
        }
      }

      console.log(`[presence] HELLO ok user=${userId} device=${deviceId} group=${groupId || "-"}`);
      return ack(cb, {
        ok: true,
        serverNowMs: Date.now(),
        data: { userId, deviceId, groupId },
      });
    } catch (e) {
      console.error("[presence] HELLO failed:", e);
      return ack(cb, {
        ok: false,
        code: "INTERNAL_ERROR",
        message: e?.message || "presence:hello failed",
      });
    }
  });

  // Client says "I'm leaving" (explicit logout / background)
  socket.on(EVENTS.GOODBYE, async (payload = {}, cb) => {
    try {
      const groupId = payload?.groupId || null;
      await finalizeOffline(userId, deviceId, socket.id);

      if (PRESENCE.BROADCASTS) {
        try {
          const s = await getUserPresence(userId);
          const room = groupId ? `group:${groupId}` : `user:${userId}`;
          nsp.to(room).emit(EVENTS.UPDATE, {
            userId,
            online: s.online,
            lastSeenMs: s.lastSeenMs,
          });
        } catch (e) {
          console.warn("[presence] broadcast error:", e?.message || e);
        }
      }

      console.log(`[presence] GOODBYE success user=${userId} device=${deviceId}`);
      return ack(cb, {
        ok: true,
        data: { userId, deviceId, groupId, serverNowMs: Date.now() },
      });
    } catch (e) {
      console.error("[presence] GOODBYE failed:", e);
      return ack(cb, {
        ok: false,
        code: "INTERNAL_ERROR",
        message: e?.message || "presence:goodbye failed",
      });
    }
  });

  // Network drop → start grace timer
  socket.on("disconnect", () => {
    try {
      beginGrace(userId, deviceId, socket.id);
    } catch (e) {
      console.error("[presence] disconnect handler error:", e?.message || e);
    }
  });

  // On connect, send initial presence state
  getUserPresence(userId)
    .then((s) => socket.emit(EVENTS.STATE, {
      online: s.online,
      lastSeenMs: s.lastSeenMs,
    }))
    .catch((e) => {
      console.warn("[presence] state send error:", e?.message || e);
    });
}
