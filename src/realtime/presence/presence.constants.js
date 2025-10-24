// src/realtime/presence/presence.constants.js
export const PRESENCE_KEYS = {
  socket: (sid) => `presence:socket:${sid}`,
  deviceHash: (uid, did) => `presence:device:${uid}:${did}`,
  deviceSockets: (uid, did) => `presence:device:sockets:${uid}:${did}`,
  userHash: (uid) => `presence:user:${uid}`,
};

export const EVENTS = {
  HELLO: "presence:hello",
  GOODBYE: "presence:goodbye",
  STATE: "presence:state",
  UPDATE: "presence:update",
};
