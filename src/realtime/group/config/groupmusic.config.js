// src/realtime/group/config/groupmusic.config.js

function toBool(val, def = false) {
  if (val === undefined || val === null) return def;
  const s = String(val).toLowerCase();
  return s === "1" || s === "true" || s === "yes";
}

function toNum(val, def) {
  const n = Number(val);
  return Number.isFinite(n) ? n : def;
}

export const GROUP_MUSIC = {
  //schedule a start
  SCHEDULE_AHEAD_MS: toNum(process.env.SCHEDULE_AHEAD_MS, 1200),

  //admin disconnects
  AUTO_PAUSE_ON_ADMIN_LEAVE: toBool(process.env.MUSIC_AUTO_PAUSE_ON_ADMIN_LEAVE, true),

  // Rate limits for requests
  REQUEST_RATE_LIMIT_PER_MIN: toNum(process.env.MUSIC_REQUEST_RATE_LIMIT, 4),
  MAX_PENDING_REQUESTS_PER_USER: toNum(process.env.MUSIC_MAX_PENDING_REQUESTS, 3),

  // Queue guardrails
  MAX_QUEUE_ITEMS: toNum(process.env.MUSIC_MAX_QUEUE_ITEMS, 500),

  // Admin seeks throttling
  SEEK_COOLDOWN_MS: toNum(process.env.MUSIC_SEEK_COOLDOWN_MS, 2000),

  // listeners list count
  LISTENERS_BROADCASTS: toBool(process.env.MUSIC_LISTENERS_BROADCASTS, true),
};
