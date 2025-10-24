// src/realtime/group/jobs/playback.coordinator.js

import Group from "../../../models/Group.js";
import { getRedis } from "../../../adapters/redis.client.js";
import { GroupRedisKeys } from "../redis.keys.js";
import { getPlayback, effectiveOffsetSec, stepPlayback } from "../playback.service.js";
import { log } from "../../../utils/logger.js";

const redis = getRedis();

const TICK_MS = Number(process.env.PB_COORD_TICK_MS || 2000);
const PAD_SEC = Number(process.env.PB_COORD_ENDPAD_SEC || 0.35);

let _timer = null;
let _running = false;

function parseGroupIdFromPlaybackKey(key) {
    const parts = String(key).split(":");
    return parts[2] || null;
}

async function handleGroup(nsp, groupId) {
    const st = await getPlayback(groupId);
    if (!st?.isPlaying) return;

    const doc = await Group.findById(groupId, { queue: 1 }).lean();
    if (!doc) return;

    const items = doc.queue?.item || [];
    const idx = typeof st.queueIndex === "number" ? st.queueIndex : -1;
    if (idx < 0 || idx >= items.length) return;

    const cur = items[idx];
    const durationSec = Number(cur?.durationSec || 0);
    const remaining = durationSec - elapsed;

    if (remaining <= -PAD_SEC) {
        await stepPlayback(nsp, groupId, null, +1);
    }
}

async function tick(nsp) {
    let cursor = "0";
    do {
        const [next, keys] = await redis.scan(cursor, "MATCH", "group:playback:*", "COUNT", 200);
        cursor = next;
        for (const key of keys) {
            const groupId = parseGroupIdFromPlaybackKey(key);
            if (groupId) {
                await handleGroup(nsp, groupId).catch(() => {});
            }
        }
    } while (cursor !== "0");
}

export function startPlaybackCoordinator(nsp) {
    if (_running) return;
    _running = true;
    _timer = setInterval(() => {
        tick(nsp).catch(() => {});
    }, TICK_MS);

    log(`[group.playback] coordinator started (tick=${TICK_MS}ms)`);
}

export function stopPlaybackCoordinator() {
    if (_timer) clearInterval(_timer);
    _timer = null;
    _running = false;

    log("[group.playback] coordinator stopped");
}