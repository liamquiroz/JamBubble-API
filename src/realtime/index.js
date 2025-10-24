// src/realtime/index.js
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { getRedisPubSub } from "../adapters/redis.client.js";
import { presenceGuard } from "./presence/presence.guard.js";
import { log } from "../utils/logger.js";
import { presence } from "./presence/presence.controller.js";
import { attachGroupHandlers, initGroupJobs } from "./group/index.js";

let ioSingleton = null;

/**
 * Initialize Socket.IO server
 */
export function initSocket(server) {
  if (ioSingleton) return ioSingleton;

  const io = new Server(server, {
    transports: ["websocket", "polling"],
    cors: {
      origin:
        process.env.CORS_ORIGINS?.split(",")
          .map((s) => s.trim())
          .filter(Boolean) || "*",
      credentials: true,
    },
    path: "/socket.io", // explicit and matches RN default
    pingInterval: 20000,
    pingTimeout: 25000,
  });

  // Optional Redis adapter for multi-instance scaling
  if (String(process.env.SOCKET_REDIS_ADAPTER || "false").toLowerCase() === "true") {
    try {
      const { pub, sub } = getRedisPubSub();
      io.adapter(createAdapter(pub, sub));
      log("[socket] redis adapter enabled");
    } catch (e) {
      log("[socket] redis adapter failed to init:", e?.message || e);
    }
  } else {
    log("[socket] redis adapter disabled");
  }

  // Main namespace
  const nsp = io.of("/realtime");

  // Auth guard (JWT + deviceId)
  nsp.use(presenceGuard);

  nsp.on("connection", (socket) => {
    const userId = socket.data?.user?._id || "unknown";
    const deviceId = socket.data?.deviceId || "unknown";
    log(`[socket] connected: uid=${userId} dev=${deviceId} sid=${socket.id}`);

    // Hello handshake back to client
    socket.emit("conn:hello", {
      serverNowMs: Date.now(),
      ns: "/realtime",
      capabilities: ["presence", "groups"],
    });

    // Attach presence logic
    try {
      presence(nsp, socket);
    } catch (err) {
      log("[socket] presence handler error:", err?.message || err);
    }

    // Attach group-related handlers
    try {
      attachGroupHandlers(nsp, socket);
      initGroupJobs(nsp);
    } catch (err) {
      log("[socket] group handler error:", err?.message || err);
    }

    // Disconnect logging
    socket.on("disconnect", (reason) => {
      log(`[socket] disconnected uid=${userId} dev=${deviceId} reason=${reason}`);
    });

    // Low-level error handling
    socket.on("error", (err) => {
      log("[socket] runtime error:", err?.message || err);
    });
  });

  // Catch global connection errors (auth guard rejections, etc.)
  nsp.on("connect_error", (err) => {
    log("[socket] connect_error:", err?.message || err);
  });

  ioSingleton = io;
  log("[socket] namespace /realtime initialized ✅");
  return ioSingleton;
}

/**
 * Retrieve existing Socket.IO instance
 */
export function getIO() {
  if (!ioSingleton) throw new Error("Socket.IO not initialized.");
  return ioSingleton;
}
