// src/realtime/presence/presence.config.js
export const PRESENCE = {
  GRACE_MS: Number(process.env.GRACE_MS || 20_000),
  STALE_MS: Number(process.env.STALE_MS || 90_000),
  BROADCASTS: String(process.env.PRESENCE_BROADCASTS || "false").toLowerCase() === "true",
};
