// src/controllers/inviteShareController.js
import crypto from "crypto";
import mongoose from "mongoose";
import Group from "../models/Group.js";
import GroupLink from "../models/GroupLink.js";
import Invite from "../models/Invite.js";
import User from "../models/User.js";

// senders
import { sendInviteEmail } from "../services/inviteMail.js";
import { sendInviteSms } from "../services/inviteSms.js";

const { PUBLIC_HOST } = process.env;

// helpers
const genToken = (n = 24) => crypto.randomBytes(n).toString("base64url");
const appBase = () => (PUBLIC_HOST?.replace(/\/$/, ""));
const buildInviteUrl = (token, inviteId) =>
  inviteId ? `${appBase()}/invite/${token}?inviteId=${inviteId}` : `${appBase()}/invite/${token}`;

// search helpers
const esc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// make digit-flexible regex so "9876" matches "+91 998-76-12345"
const digitsToFlexibleRx = (q) => {
  const d = String(q).replace(/\D+/g, "");
  if (!d) return null;
  return new RegExp(d.split("").map(esc).join("\\D*")); // digits with optional non-digits between
};

async function ensureNoInviteTokenIndex() {
  try {
    const col = mongoose.connection.db.collection("invites");
    const indexes = await col.indexes().catch(() => []);
    const bad = indexes.find((i) => i.key && i.key.token === 1);
    if (bad) await col.dropIndex(bad.name);
  } catch {}
}

async function ensureGroupLink(groupId, createdByUserId) {
  let gl = await GroupLink.findOne({ groupId }).lean();
  if (!gl) {
    gl = await GroupLink.create({ groupId, createdByUserId, token: genToken() });
    gl = gl.toObject();
  }
  return gl;
}

// NEW: membership check for nested schema
async function userCanInvite({ inviterUserId, groupId }) {
  const group = await Group.findById(groupId).select("members").lean();
  if (!group) return false;
  return group.members?.some((m) => String(m?.user?.ref) === String(inviterUserId));
}

// NEW: push nested member shape if needed
async function addUserToGroupIfNeeded({ userId, groupId }) {
  const group = await Group.findById(groupId);
  if (!group) throw new Error("Group not found");

  const isAlreadyMember = group.members?.some((m) => String(m?.user?.ref) === String(userId));
  if (!isAlreadyMember) {
    group.members.push({
      user: {
        ref: new mongoose.Types.ObjectId(userId),
        isAdmin: false,
        isMute: false,
        isPinned: false,
        isOnline: false,
      },
      joinedAt: new Date(),
    });
    await group.save();
  }
  return group;
}

// mark matching pending invites as accepted
async function reconcilePendingInvites({ groupId, user }) {
  const or = [];
  if (user?._id) or.push({ recipientUserId: user._id });
  if (user?.email) or.push({ recipientEmail: user.email.toLowerCase() });
  if (user?.phone) or.push({ recipientPhone: user.phone });
  if (!or.length) return;

  await Invite.updateMany(
    { groupId, status: "PENDING", $or: or },
    { $set: { status: "ACCEPTED", acceptedAt: new Date(), acceptedByUserId: user._id } }
  );
}

// controllers

export const createShareLink = async (req, res) => {
  try {
    await ensureNoInviteTokenIndex();
    const { groupId } = req.body;
    if (!groupId) return res.status(400).json({ message: "groupId is required" });

    // FIX: forbid if NOT a member
    if (!(await userCanInvite({ inviterUserId: req.user.id, groupId }))) {
      return res.status(403).json({ message: "Not allowed to create share link for this group" });
    }

    const gl = await ensureGroupLink(groupId, req.user.id);
    res
      .status(200)
      .json({ message: "Share link ready", token: gl.token, inviteUrl: buildInviteUrl(gl.token) });
  } catch (err) {
    res.status(500).json({ message: "Failed to create share link", error: err.message });
  }
};

export const resolveLink = async (req, res) => {
  try {
    const { token } = req.params;

    const gl = await GroupLink.findOne({ token, isActive: true }).lean();
    if (!gl) return res.status(410).json({ message: "Link invalid or inactive" });

    const groupDoc = await Group.findById(gl.groupId)
      // REMOVED: admin (no longer in schema)
      .select("groupName groupSubtitle groupImage groupCode members")
      .lean();

    if (!groupDoc) {
      return res.status(200).json({ message: "Resolved", token, group: null });
    }

    const toAbs = (u) => {
      if (!u) return null;
      if (/^https?:\/\//i.test(u)) return u;
      const base = appBase() || "";
      return base ? `${base}${u.startsWith("/") ? "" : "/"}${u}` : u;
    };

    // take first 12 member IDs from nested structure
    const firstMembers = Array.isArray(groupDoc.members) ? groupDoc.members.slice(0, 12) : [];
    const memberIds = firstMembers
      .map((m) => m?.user?.ref)
      .filter(Boolean)
      .map((id) => new mongoose.Types.ObjectId(id));

    const users = memberIds.length
      ? await User.find({ _id: { $in: memberIds } })
          .select("_id fName lName email avatarUrl profilePic image photo")
          .lean()
      : [];

    const members = users.map((u) => {
      const name =
        [u.fName, u.lName].filter(Boolean).join(" ") ||
        (u.email ? u.email.split("@")[0] : "Member");
      const avatar = toAbs(u.avatarUrl || u.profilePic || u.image || u.photo || null);
      return { id: u._id, name, avatar };
    });

    // derive admin IDs from nested flags (optional for clients that need it)
    const adminIds = (groupDoc.members || [])
      .filter((m) => m?.user?.isAdmin)
      .map((m) => String(m.user.ref));

    const group = {
      id: groupDoc._id,
      groupName: groupDoc.groupName,
      groupSubtitle: groupDoc.groupSubtitle,
      groupImage: toAbs(groupDoc.groupImage),
      groupCode: groupDoc.groupCode,
      members,
      adminIds, // new (replaces deprecated single admin field)
    };

    return res.status(200).json({ message: "Resolved", token, group });
  } catch (err) {
    return res.status(500).json({ message: "Failed to resolve link", error: err.message });
  }
};

export const joinGroupWithLink = async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ message: "token is required" });

    const gl = await GroupLink.findOne({ token, isActive: true }).lean();
    if (!gl) return res.status(410).json({ message: "Link invalid or inactive" });

    const group = await addUserToGroupIfNeeded({ userId: req.user.id, groupId: gl.groupId });
    await reconcilePendingInvites({ groupId: group._id, user: req.user });

    res.status(200).json({
      message: "Joined group successfully",
      group: { id: group._id, groupName: group.groupName, groupCode: group.groupCode },
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to join group", error: err.message });
  }
};

export const sendInviteEmailController = async (req, res) => {
  try {
    await ensureNoInviteTokenIndex();

    const { groupId, to } = req.body;
    if (!groupId || !to) return res.status(400).json({ message: "groupId and to (email) are required" });

    // FIX: forbid if NOT a member
    if (!(await userCanInvite({ inviterUserId: req.user.id, groupId }))) {
      return res.status(403).json({ message: "Not allowed to invite to this group" });
    }

    const gl = await ensureGroupLink(groupId, req.user.id);
    const existingUser = await User.findOne({ email: to.toLowerCase() }, { _id: 1 }).lean();

    const invite = await Invite.create({
      groupId,
      inviterUserId: req.user.id,
      channel: "EMAIL",
      recipientEmail: to,
      recipientUserId: existingUser?._id,
      status: "PENDING",
    });

    const inviterUser = await User.findById(req.user.id).select("fName lName").lean();
    const inviterName = [inviterUser?.fName, inviterUser?.lName].filter(Boolean).join(" ");
    const inviteUrl = buildInviteUrl(gl.token, invite._id.toString());
    const groupDoc = await Group.findById(groupId).select("groupName").lean();

    await sendInviteEmail({ to, inviteUrl, groupName: groupDoc?.groupName || "Jam", inviterName });

    res.status(200).json({
      message: "Invite email sent",
      inviteId: invite._id,
      inviteUrl,
      token: gl.token,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to send invite email", error: err.message });
  }
};

export const sendInviteSmsController = async (req, res) => {
  try {
    await ensureNoInviteTokenIndex();

    const { groupId, to } = req.body;
    if (!groupId || !to) return res.status(400).json({ message: "groupId and to (phone) are required" });

    // FIX: forbid if NOT a member
    if (!(await userCanInvite({ inviterUserId: req.user.id, groupId }))) {
      return res.status(403).json({ message: "Not allowed to invite to this group" });
    }

    const gl = await ensureGroupLink(groupId, req.user.id);
    const existingUser = await User.findOne({ phone: to }, { _id: 1 }).lean();

    const invite = await Invite.create({
      groupId,
      inviterUserId: req.user.id,
      channel: "SMS",
      recipientPhone: to,
      recipientUserId: existingUser?._id,
      status: "PENDING",
    });

    const inviterUser = await User.findById(req.user.id).select("fName lName").lean();
    const inviterName = [inviterUser?.fName, inviterUser?.lName].filter(Boolean).join(" ");
    const inviteUrl = buildInviteUrl(gl.token, invite._id.toString());
    const groupDoc = await Group.findById(groupId).select("groupName").lean();

    await sendInviteSms({ to, inviteUrl, groupName: groupDoc?.groupName || "Jam", inviterName });

    res.status(200).json({
      message: "Invite SMS sent",
      inviteId: invite._id,
      inviteUrl,
      token: gl.token,
    });
  } catch (err) {
    res.status(500).json({ message: "Failed to send invite SMS", error: err.message });
  }
};

export const inviteSearch = async (req, res) => {
  try {
    const q = req.query.q?.trim() ?? "";
    const page = Math.max(parseInt(req.query.page || "1", 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || "20", 10), 1), 50);
    const skip = (page - 1) * limit;

    if (!q) return res.status(200).json({ ok: true, total: 0, page, limit, items: [] });

    const emailRx = new RegExp(esc(q), "i"); // email substring, case-insensitive
    const nameRx = new RegExp(esc(q), "i"); // name substring
    const phoneRx = digitsToFlexibleRx(q); // digits subsequence for mobileNo

    const or = [{ email: emailRx }, { fName: nameRx }, { lName: nameRx }];
    if (phoneRx) or.push({ mobileNo: phoneRx });

    const filter = { $or: or };

    const [users, total] = await Promise.all([
      User.find(filter).select({ _id: 1, email: 1, mobileNo: 1, profilePic: 1 }).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      User.countDocuments(filter),
    ]);

    const items = users.map((u) => ({
      id: u._id,
      email: u.email ?? null,
      mobileNo: u.mobileNo ?? null,
      profilePic: u.profilePic ?? null,
    }));

    return res.status(200).json({ ok: true, total, page, limit, items });
  } catch (err) {
    console.error("searchPeople error:", err);
    return res.status(500).json({ ok: false, message: "Failed to search people", error: err.message });
  }
};

export const listPendingInvites = async (req, res) => {
  try {
    const groupId = req.params.id;
    const requesterId = req.user.id;

    // Must exist
    const group = await Group.findById(groupId).select('members').lean();
    if (!group) return res.status(404).json({ message: 'Group not found' });

    // Admin-only (change to members-only if you prefer)
    const isAdmin = group.members?.some(
      (m) => String(m?.user?.ref) === String(requesterId) && m?.user?.isAdmin === true
    );
    if (!isAdmin) {
      return res.status(403).json({ message: 'Admins only' });
    }

    // Query params
    const rawStatus = (req.query.status || 'PENDING').toString().toUpperCase();
    const allowed = ['PENDING', 'ACCEPTED', 'CANCELLED', 'EXPIRED'];
    if (!allowed.includes(rawStatus)) {
      return res.status(400).json({ message: `Invalid status. Use one of: ${allowed.join(', ')}` });
    }

    const page = Math.max(parseInt(req.query.page || '1', 10), 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10), 1), 100);
    const skip = (page - 1) * limit;

    const filter = { groupId, status: rawStatus };

    const [invites, total] = await Promise.all([
      Invite.find(filter)
        .select('_id groupId channel status recipientUserId recipientEmail recipientPhone createdAt')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Invite.countDocuments(filter),
    ]);

    // Enrich with recipient user details (if recipientUserId exists)
    const userIds = [...new Set(invites.map(i => i.recipientUserId).filter(Boolean).map(String))];
    const users = userIds.length
      ? await User.find({ _id: { $in: userIds } })
          .select('_id fName lName email profilePic avatarUrl image photo')
          .lean()
      : [];
    const byId = new Map(users.map(u => [String(u._id), u]));

    const items = invites.map((i) => {
      const u = i.recipientUserId ? byId.get(String(i.recipientUserId)) : null;
      const name = u ? [u.fName, u.lName].filter(Boolean).join(' ').trim() : null;
      const email = i.recipientEmail || (u?.email ?? null);
      const avatar = u?.profilePic || u?.avatarUrl || u?.image || u?.photo || null;

      return {
        inviteId: i._id,
        userId: i.recipientUserId || null,
        name,
        email,
        phone: i.recipientPhone || null,
        channel: i.channel,     // "EMAIL" | "SMS"
        status: i.status,       // PENDING | ACCEPTED | CANCELLED | EXPIRED
        createdAt: i.createdAt,
        avatar,
      };
    });

    return res.status(200).json({
      message: 'Invites fetched',
      status: rawStatus,
      page,
      limit,
      total,
      items,
    });
  } catch (err) {
    return res
      .status(500)
      .json({ message: 'Failed to fetch invites', error: err.message });
  }
};
