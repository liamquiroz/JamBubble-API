// src/realtime/group/redis.keys.js

export const GroupRedisKeys = {
  //playback state for a group
  playback: (groupId) => `group:playback:${groupId}`,

  // Members actively "listening now"
  listenersSet: (groupId) => `group:listeners:${groupId}`,

  opcache: (groupId) => `group:opcache:${groupId}`,

  requestBucket: (groupId, userId) => `ratelimit:req:${groupId}:${userId}`,

  seekCooldown: (groupId, userId) => `cooldown:seek:${groupId}:${userId}`,
};

export const GroupRooms = {
  group: (groupId) => `grp:${groupId}`,
  user: (userId) => `usr:${userId}`,
};
