//src/realtime/group/requests.service.js
import crypto from "crypto";
import Group from "../../models/Group.js";
import { GroupRedisKeys, GroupRooms } from "./redis.keys.js";
import { GROUP_MUSIC } from "./config/groupmusic.config.js";
import { broadcastQueue } from "./queue.service.js";

function rid() {
    return crypto.ramdomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex");
}

function nowMs() { return Date.now(); }

export async function assertRequestRate(nspRedis, groupId, userId) { 
    const key = GroupRedisKeys.requestBucket(groupId, userId);
    const count = await nspRedis.incr(key);
    if (count === 1) await nspRedis.expire(key, 60);
    if (count > GROUP_MUSIC.REQUEST_RATE_LIMIT_PER_MIN) {
        const ttl = await nspRedis.ttl(key);
        const retryIn = ttl > 0 ? ttl: 60;
        return { ok: false, code: "RATE_LIMITED", retryInSec: retryIn };
    }
    return { ok: true };
}

async function assertPendingLimit(group, userId) {
    const pending = (group.requests?.items || []).filter(
        (r) => r.status === "PENDING" && String(r.requestedBy) === String(userId)
    ).length;
    if (pending >= GROUP_MUSIC.MAX_PENDING_REQUESTS_PER_USER) {
        return {
            ok: false,
            code: "MAX_PENDING",
            limit: GROUP_MUSIC.MAX_PENDING_REQUESTS_PER_USER,
        };
    }
    return { ok: true };
}

export async function submitRequest(nsp, redis, groupId, userId, track) {
    
    const r1 = await assertRequestRate(redis, groupId, userId);
    if (!r1.ok) return r1;

    if (!track || (!track.trackId && !track.trackUrl)) {
        return { ok: false, code: "INVALID_TRACK" };
    }

    const group = await Group.findById(groupId, {
        requests: 1,
        members: 1,
    }).lean();
    if (!group) return { ok: false, code: "NOT_FOUND" };

    const p1 = await assertPendingLimit(group, userId);
    if (!p1.ok) return p1;

    const req = {
        id: rid(),
        trackId: track.trackId || undefined,
        trackUrl: track.trackUrl || undefined,
        title: track.title || "",
        artist: track.artist || "",
        durationSec: typeof track.durationSec === "number" ? track.durationSec : undefined,
        requestedBy: userId,
        status: "PENDING",
    };

    await Group.updateOne(
        {_id: groupId},
        {
            $push: { "requests.items": req }
        }
    );

    nsp.to(GroupRooms.group(groupId)).emit("v1:request:new", {
        groupId,
        request: {
            id: req.id,
            title: req.title,
            artist: req.artist,
            requestedBy: String(userId),
        },
    });

    return { ok: true, requestId: req.id };

}

export async function approveRequest(nsp, groupId, adminUserId, requestId) {
    const doc = await Group.findById(groupId).lean();
    if (!doc) return { ok: false, code: "NOT_FOUND" };

    const req = (doc.requests?.items || []).find((r) => r.id === requestId);
    if (!req) return { ok: false, code: "NOT_FOUND_REQUEST" };
    if (req.status !== "PENDING") return { ok: false, code: "ALREADY_REVIEWED" };

    const qItem = {
        id: rid(),
        trackId: req.trackId || undefined,
        trackUrl: req.trackUrl || undefined,
        title: req.title || "",
        artist: req.artist || "",
        durationSec: typeof req.durationSec === "number" ? req.durationSec : undefined,
        addedBy: adminUserId,
        addedAt: new Date(),
    };

    const res = await Group.findByIdAndUpdate(
        { _id: groupId, "requests.items.id": requestId },
        {
            $set: {
                "requests.items.$.status": "APPROVED",
                "requests.items.$.reviewedBy": adminUserId,
            },
            $push: { "queue.item": qItem },
            $inc: { "queue.version": 1 },
        },
        { new: true, projection: { queue: 1, requests: 1 } }
    ).lean();

    if (!res) return { ok: false, code: "CONFLICT" };

    const requesterId = String(req.requestedBy);
    nsp.to(GroupRooms.user(requesterId)).emit("v1:request:update", {
        groupId,
        id: requestId,
        status: "APPROVED",
    });

    await broadcastQueue(nsp, groupId);

    return { ok: true, addedItemId: qItem.id, version: res.queue.version };
}

export async function rejectRequest(nsp, groupId, adminUserId, requestId, reason) {
    const res = await Group.findByIdAndUpdate(
        { 
            _id: groupId,
            "requests.items.id": requestId,
            "requests.items.status": "PENDING"
        },
        {
            $set: {
                "requests.items.$.status": "REJECTED",
                "requests.items.$.reviewedBy": adminUserId,
            },
        },
        { new: false }
    );

    if (!res) return { ok: false, code: "NOT_FOUND_ALREADY_REVIEWED" };

    const cur = await Group.findById(groupId, { requests: 1 }).lean();
    const updated = (cur.requests?.items || []).find((r) => r.id === requestId);
    if (updated) {
        const requesterId = String(updated.requestedBy);
        nsp.to(GroupRooms.user(requesterId)).emit("v1:request:update", {
            groupId,
            id: requestId,
            status: "REJECTED",
            reason: reason || undefined,
        });
    }

    return { ok: true };
}
