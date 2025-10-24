// src/realtime/group/jobs/listeners.sweeper.js

import { getRedis } from "../../../adapters/redis.client.js";
import { log } from "../../../utils/logger.js";

const redis = getRedis();

const SWEEP_MS = Number(process.env.LISTENERS_SWEEP_MS || 60_000);

let _timer = null;
let _running = false;

function parseGroupIdFromListenersKey(key) {
    const parts = String(key).split(":");
    return parts[2] || null;
}

async function isUserOnline(userId) {
    const h = await redis.hgetall(`presence:user:${userId}`);
    return h && h.online === "1";
}

async function sweepGroup(groupId) {
    const key = `group:listners:${groupId}`;
    const members = await redis.smembers(key);
    if (!members || members.length === 0) return { removed: 0, total: 0 };

    let removed = 0;

    for (const uid of members) {

        const online = await isUserOnline(uid).catch(() => false);
        if (!online) {
            await redis.srem(key, uid).catch(() => {});
            removed++;
        }
    }
    return { removed, total: members.length };
}

async function sweepAll() {
    let cursor = "0";
    let totalGroups = 0;
    let totalRemoved = 0;

    do {
        const [next, keys] = await redis.scan(cursor, "MATCH", "group:listeners:*", "COUNT", 200);
        cursor = next;

        for (const key of keys) {
            const groupId = parseGroupIdFromListenersKey(key);
            if (!groupId) continue;

            const res = await sweepGroup(groupId).catch(() => ({ removed: 0, total: 0 }));
            totalGroups++;
            totalRemoved += res.removed;
        }
    } while (cursor !== "0");

    log(`[group.listeners] sweep groups=${totalGroups} removed=${totalRemoved}`);
}
 
export function startListenersSweeper() {
    if (_running) return;
    _running = true;
    _timer = setInterval(() => {
        sweepAll().catch(() => {});
    }, SWEEP_MS);
    log(`[group.listeners] sweeper started (every ${SWEEP_MS}ms)`);
}

export function stopListenersSweeper() {
    if (_timer) clearInterval(_timer);
    _timer = null;
    _running = false;

    log("[group.listeners] sweeper stopped");
}