// src/realtime/presence/presence.guard.js
import jwt from "jsonwebtoken";

/**
 * presenceGuard middleware
 * Expects: socket.handshake.auth = { token, deviceId }
 * Populates: socket.data.user._id, socket.data.deviceId
 */
export async function presenceGuard(socket, next) {
  try {
    const { token: authToken, deviceId } = socket.handshake?.auth || {};

    // Log handshake snapshot for debug
    console.log("[presenceGuard] handshake.auth:", socket.handshake?.auth);

    // Fallback to Authorization header if needed
    const headerToken = socket.handshake?.headers?.authorization?.replace(/^Bearer\s+/i, "");
    const token = authToken || headerToken || null;

    if (!token) {
      console.warn("[presenceGuard] ❌ Missing token");
      return next(new Error("UNAUTHORIZED_MISSING_TOKEN"));
    }

    if (!deviceId) {
      console.warn("[presenceGuard] ❌ Missing deviceId");
      return next(new Error("BAD_REQUEST_MISSING_DEVICE_ID"));
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) {
      console.error("[presenceGuard] ❌ JWT_SECRET not set in env");
      return next(new Error("SERVER_MISCONFIG_JWT_SECRET"));
    }

    let payload;
    try {
      payload = jwt.verify(token, secret);
    } catch (e) {
      console.warn("[presenceGuard] ❌ Invalid token:", e?.message || e);
      return next(new Error("UNAUTHORIZED_INVALID_TOKEN"));
    }

    // Extract usable user ID
    const userId =
      payload?.id || payload?._id || payload?.userId || payload?.sub || null;

    if (!userId) {
      console.warn("[presenceGuard] ⚠️ No userId in token payload:", payload);
      return next(new Error("UNAUTHORIZED_NO_USER_ID"));
    }

    socket.data.user = { _id: String(userId) };
    socket.data.deviceId = String(deviceId);

    console.log(
      `[presenceGuard] ✅ Auth success user=${userId} device=${deviceId} socket=${socket.id}`
    );

    return next();
  } catch (err) {
    console.error("[presenceGuard] INTERNAL_ERROR:", err);
    return next(new Error("INTERNAL_ERROR"));
  }
}
