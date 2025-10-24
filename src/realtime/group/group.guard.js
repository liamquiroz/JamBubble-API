// src/realtime/group/group.guard.js
import Group from "../../models/Group.js"; 

/**
 * Helper: ensure the connected user is a member of the group.
 * Caches membership on socket.data for the session to avoid repeated DB hits.
 */
export async function ensureGroupMember(socket, groupId) {
  const uid = String(socket.data?.user?._id || "");
  if (!uid) throw new Error("UNAUTHORIZED: no user on socket");

  // Fast path cache
  socket.data._groups = socket.data._groups || new Map();
  if (socket.data._groups.has(groupId)) return socket.data._groups.get(groupId);

  const group = await Group.findOne({ _id: groupId }, { members: 1, controllerUserId: 1 }).lean();
  if (!group) throw new Error("NOT_FOUND: group");
  const isMember = group.members?.some((m) => String(m.user?.ref) === uid);
  if (!isMember) throw new Error("FORBIDDEN: not a member of this group");

  const isAdmin = group.members?.some(
    (m) => String(m.user?.ref) === uid && m.user?.isAdmin === true
  );

  const ctx = {
    groupId,
    isMember: true,
    isAdmin,
    controllerUserId: group.controllerUserId ? String(group.controllerUserId) : null,
  };
  socket.data._groups.set(groupId, ctx);
  return ctx;
}

/**
 * Helper: ensure the connected user is allowed to control playback for the group.
 * - If controllerUserId is set, only that user controls.
 * - Else, any admin can control.
 */
export async function ensureGroupController(socket, groupId) {
  const ctx = await ensureGroupMember(socket, groupId);
  const uid = String(socket.data?.user?._id || "");

  if (ctx.controllerUserId) {
    if (ctx.controllerUserId !== uid) {
      throw new Error("FORBIDDEN: only controller can do this");
    }
    return { ...ctx, canControl: true };
  }
  if (!ctx.isAdmin) throw new Error("FORBIDDEN: admin only");
  return { ...ctx, canControl: true };
}
