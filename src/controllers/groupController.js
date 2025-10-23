// src/controllers/groupController.js
import mongoose from "mongoose";
import Group from "../models/Group.js";
import { groupImageFile } from "../utils/uploadServices/cloudinaryUploader.js";
import { v2 as cloudinary } from "cloudinary";

//  Generate unique 6-digit alphanumeric code
function generateGroupCode() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

const toStr = (v) => String(v);
const isMember = (group, userId) =>
  group.members?.some((m) => toStr(m.user?.ref) === toStr(userId));
const isAdmin = (group, userId) =>
  group.members?.some(
    (m) => toStr(m.user?.ref) === toStr(userId) && m.user?.isAdmin === true
  );

const buildMember = (userId, flags = {}) => ({
  user: {
    ref: new mongoose.Types.ObjectId(userId),
    isAdmin: !!flags.isAdmin,
    isMute: !!flags.isMute,
    isPinned: !!flags.isPinned,
    isOnline: !!flags.isOnline,
  },
  joinedAt: new Date(),
});

//  Create Group
export const createGroup = async (req, res) => {
  try {
    const { groupName, groupSubtitle } = req.body;

    if (!groupName) {
      return res.status(400).json({ message: "Group name is required" });
    }

    if (!groupSubtitle) {
      return res.status(400).json({ message: "Group Subtitle is required" });
    }

    const groupCode = generateGroupCode();
    let groupImageUrl = "";
    let publicId = "";

    if (req.file) {
      const result = await groupImageFile(req.file);
      groupImageUrl = result.url;
      publicId = result.publicId;
    }

    const newGroup = await Group.create({
      groupName,
      groupSubtitle,
      groupCode,
      groupImage: groupImageUrl,
      groupImagePublicId: publicId,
      members: [buildMember(req.user.id, { isAdmin: true })],
      playback: {},
      queue: {},
      settings: { allowListenerEnqueue: true },
    });

    res.status(200).json({ message: "Group created", group: newGroup });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to create group", error: err.message });
  }
};

//  Join Group
export const joinGroup = async (req, res) => {
  try {
    const { groupCode } = req.body;

    const group = await Group.findOne({ groupCode });
    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    if (isMember(group, req.user.id)) {
      return res
        .status(400)
        .json({ message: "User already a member of this group" });
    }

    group.members.push(buildMember(req.user.id));
    await group.save();

    res.status(200).json({ message: "Joined group successfully", group });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to join group", error: err.message });
  }
};

// Group Edit
export const groupDetailsEdit = async (req, res) => {
  try {
    const groupId = req.params.id;
    const userId = req.user.id;

    const group = await Group.findById(groupId);
    if (!group) return res.status(404).json({ message: "Group not found" });

    if (
      !group.members?.some(
        (m) =>
          String(m.user?.ref) === String(userId) && m.user?.isAdmin === true
      )
    ) {
      return res
        .status(403)
        .json({ message: "Only admin can update group details" });
    }

    const { groupName, groupSubtitle } = req.body || {};
    let changed = false;

    // Update name/subtitle only if provided (not undefined/null)
    if (typeof groupName === "string") {
      group.groupName = groupName.trim();
      changed = true;
    }
    if (typeof groupSubtitle === "string") {
      group.groupSubtitle = groupSubtitle.trim();
      changed = true;
    }

    // Optional image replacement via file upload
    if (req.file) {
      try {
        if (group.groupImagePublicId) {
          await cloudinary.uploader.destroy(group.groupImagePublicId, {
            resource_type: "image",
          });
        }
      } catch (e) {
        // log but don't fail the whole request on destroy error
        console.warn("Cloudinary destroy failed:", e?.message || e);
      }

      const { url, publicId } = await groupImageFile(req.file);
      group.groupImage = url; // <-- updates groupImage
      group.groupImagePublicId = publicId;
      changed = true;
    }

    if (!changed) {
      return res.status(400).json({
        message:
          "No changes provided. Include groupName, groupSubtitle, or an image file.",
      });
    }

    await group.save();
    return res.status(200).json({ message: "Group details updated", group });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Failed to update group details", error: err.message });
  }
};

// fetch all Joined group
// fetch all Joined groups + include members (fName, lName, mobileNo, email + flags)
export const getMyGroup = async (req, res) => {
  try {
    const userId = req.user.id;

    const groups = await Group.find({ 'members.user.ref': userId })
      .select('groupName groupSubtitle groupImage groupCode members')
      .sort({ createdAt: -1 })
      .populate({
        path: 'members.user.ref',
        select: 'fName lName mobileNo email profilePic',
      });

    const shapeMembers = (members = []) =>
      members.map((m) => {
        const u = m.user?.ref; // populated User doc
        return {
          userId: String(u?._id || m.user?.ref),
          fName: u?.fName ?? null,
          lName: u?.lName ?? null,
          mobileNo: u?.mobileNo ?? null,
          email: u?.email ?? null,
          profilePic: u?.profilePic ?? null,
          isAdmin: !!m.user?.isAdmin,
          isMute: !!m.user?.isMute,
          isPinned: !!m.user?.isPinned,
          isOnline: !!m.user?.isOnline,
          joinedAt: m.joinedAt,
        };
      });

    const response = groups.map((g) => ({
      _id: g._id,
      groupName: g.groupName,
      groupSubtitle: g.groupSubtitle,
      groupImage: g.groupImage,
      groupCode: g.groupCode,
      members: shapeMembers(g.members),
    }));

    res.status(200).json({ message: 'Group fetched Success', groups: response });
  } catch (err) {
    res.status(500).json({ message: 'Feiled to fetch group', error: err.message });
  }
};


// invite Code
export const getGroupInviteCode = async (req, res) => {
  try {
    const groupId = req.params.id;
    const userId = req.user.id;

    const group = await Group.findById(groupId).select("groupCode members");

    if (!group) {
      return res.status(404).json({ message: "Group not Found" });
    }

    if (!isMember(group, userId)) {
      return res
        .status(403)
        .json({ message: "Access denied. You are not a member" });
    }

    res.status(200).json({
      message: "Invite Code fetch successfully",
      groupCode: group.groupCode,
    });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to fetch invite code", error: err.message });
  }
};

// get group details
// get group details (with member profile fields)
export const getGroupDetails = async (req, res) => {
  try {
    const groupId = req.params.id;

    const group = await Group.findById(groupId)
      .select("groupName groupSubtitle groupImage groupCode members")
      .populate({
        path: "members.user.ref",
        select: "fName lName mobileNo email profilePic", // <-- requested fields
      });

    if (!group) {
      return res.status(404).json({ message: "Group not found" });
    }

    // shape members to expose user profile + flags
    const members = (group.members || []).map((m) => {
      const u = m.user?.ref; // populated User doc
      return {
        userId: String(u?._id || m.user?.ref),
        fName: u?.fName ?? null,
        lName: u?.lName ?? null,
        mobileNo: u?.mobileNo ?? null,
        email: u?.email ?? null,
        profilePic: u?.profilePic ?? null,
        isAdmin: !!m.user?.isAdmin,
        isMute: !!m.user?.isMute,
        isPinned: !!m.user?.isPinned,
        isOnline: !!m.user?.isOnline,
        joinedAt: m.joinedAt,
      };
    });

    res.status(200).json({
      message: "group details fetched",
      group: {
        _id: group._id,
        groupName: group.groupName,
        groupSubtitle: group.groupSubtitle,
        groupImage: group.groupImage,
        groupCode: group.groupCode,
        members,
      },
    });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to fetch group details", error: err.message });
  }
};

// Member leave Group
export const exitGroup = async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ message: "Group not found" });

    if (!isMember(group, req.user.id)) {
      return res
        .status(400)
        .json({ message: "You are not a member of this group" });
    }

    // In original code, admin could not leave. Keep same rule:
    if (isAdmin(group, req.user.id)) {
      return res.status(403).json({
        message:
          "Admin cannot leave the group. You must delete or transfer ownership.",
      });
    }

    group.members = group.members.filter(
      (m) => toStr(m.user.ref) !== toStr(req.user.id)
    );
    await group.save();

    res.status(200).json({ message: "You have left the group" });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to exit group", error: err.message });
  }
};

export const removeMember = async (req, res) => {
  const { id, memberId } = req.params;
  const userId = req.user.id;

  try {
    const group = await Group.findById(id);
    if (!group) return res.status(404).json({ message: "Group not found" });

    if (!isAdmin(group, userId)) {
      return res.status(403).json({ message: "Only admin can remove members" });
    }

    if (!isMember(group, memberId)) {
      return res
        .status(400)
        .json({ message: "User is not a member of this group" });
    }

    // prevent an admin from removing themselves via this endpoint (same behavior)
    if (toStr(memberId) === toStr(userId) && isAdmin(group, userId)) {
      return res
        .status(400)
        .json({ message: "Admin cannot remove themselves" });
    }

    group.members = group.members.filter(
      (m) => toStr(m.user.ref) !== toStr(memberId)
    );
    await group.save();

    res.status(200).json({ message: "Member removed from group" });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to remove member", error: err.message });
  }
};

export const deleteGroup = async (req, res) => {
  try {
    const group = await Group.findById(req.params.id);
    if (!group) return res.status(404).json({ message: "Group not found" });

    if (!isAdmin(group, req.user.id)) {
      return res
        .status(403)
        .json({ message: "Only admin can delete the group" });
    }

    await group.deleteOne();
    res.status(200).json({ message: "Group deleted successfully" });
  } catch (err) {
    res
      .status(500)
      .json({ message: "Failed to delete group", error: err.message });
  }
};

export const transferAdmin = async (req, res) => {
  try {
    const { id, memberId } = req.params; // group id & target member id
    const requesterId = req.user.id;

    const group = await Group.findById(id);
    if (!group) return res.status(404).json({ message: "Group not found" });

    if (!isAdmin(group, requesterId)) {
      return res.status(403).json({ message: "Admins only" });
    }

    if (!isMember(group, memberId)) {
      return res
        .status(400)
        .json({ message: "Target user is not a member of this group" });
    }

    // If the target is already the only admin, no-op
    const targetIsAlreadyOnlyAdmin = group.members.every((m) =>
      String(m.user.ref) === String(memberId)
        ? m.user.isAdmin === true
        : m.user.isAdmin === false
    );
    if (targetIsAlreadyOnlyAdmin) {
      return res
        .status(200)
        .json({ message: "Admin already transferred", group });
    }

    // Set selected member as the ONLY admin
    group.members.forEach((m) => {
      m.user.isAdmin = String(m.user.ref) === String(memberId);
    });

    await group.save();
    return res.status(200).json({ message: "Admin transferred", group });
  } catch (err) {
    return res
      .status(500)
      .json({ message: "Failed to transfer admin", error: err.message });
  }
};

// List all members with flags + member name + profilePic + mobileNo + email (member-only)
export const listMembers = async (req, res) => {
  try {
    const { id } = req.params; // group id
    const requesterId = req.user.id;

    const group = await Group.findById(id)
      .select('members')
      .populate({ path: 'members.user.ref', select: 'fName lName profilePic mobileNo email' });

    if (!group) return res.status(404).json({ message: 'Group not found' });

    const amIMember = group.members?.some(
      (m) => String(m.user?.ref?._id || m.user?.ref) === String(requesterId)
    );
    if (!amIMember) {
      return res.status(403).json({ message: 'Access denied. Members only.' });
    }

    const members = group.members.map((m) => {
      const uDoc = m.user?.ref; // populated User doc
      const userId = String(uDoc?._id || m.user?.ref);
      const fName = uDoc?.fName ?? '';
      const lName = uDoc?.lName ?? '';
      const name = [fName, lName].filter(Boolean).join(' ').trim() || null;

      return {
        userId,
        name,
        fName,
        lName,
        profilePic: uDoc?.profilePic ?? null,
        mobileNo: uDoc?.mobileNo ?? null,  // <-- added
        email: uDoc?.email ?? null,        // <-- added
        isAdmin: !!m.user?.isAdmin,
        isMute: !!m.user?.isMute,
        isPinned: !!m.user?.isPinned,
        isOnline: !!m.user?.isOnline,
        joinedAt: m.joinedAt,
      };
    });

    return res.status(200).json({ message: 'Members fetched', members });
  } catch (err) {
    return res
      .status(500)
      .json({ message: 'Failed to fetch members', error: err.message });
  }
};


// PATCH /api/groups/:id/members/:memberId
// Body: { isPinned?: boolean, isMute?: boolean }
export const updateMemberFlags = async (req, res) => {
  try {
    const { id, memberId } = req.params;   // group id, target user id
    const requesterId = req.user.id;

    // normalize booleans from body (accepts true/false or "true"/"false")
    const toBool = (v) =>
      typeof v === 'boolean'
        ? v
        : typeof v === 'string'
        ? (v.toLowerCase() === 'true' ? true : v.toLowerCase() === 'false' ? false : undefined)
        : undefined;

    const nextPinned = toBool(req.body?.isPinned);
    const nextMute = toBool(req.body?.isMute);

    if (nextPinned === undefined && nextMute === undefined) {
      return res.status(400).json({ message: 'Provide at least one of: isPinned, isMute' });
    }

    const group = await Group.findById(id);
    if (!group) return res.status(404).json({ message: 'Group not found' });

    // requester must be a member
    const requesterIsMember = group.members?.some(
      (m) => String(m.user?.ref) === String(requesterId)
    );
    if (!requesterIsMember) {
      return res.status(403).json({ message: 'Members only' });
    }

    const targetIsRequester = String(memberId) === String(requesterId);

    // if updating someone else -> must be admin
    if (!targetIsRequester) {
      const requesterIsAdmin = group.members?.some(
        (m) => String(m.user?.ref) === String(requesterId) && m.user?.isAdmin === true
      );
      if (!requesterIsAdmin) {
        return res.status(403).json({ message: 'Admins only to modify other members' });
      }
    }

    const member = group.members.find((m) => String(m.user?.ref) === String(memberId));
    if (!member) {
      return res.status(404).json({ message: 'Member not found in this group' });
    }

    if (nextPinned !== undefined) member.user.isPinned = nextPinned;
    if (nextMute !== undefined) member.user.isMute = nextMute;

    await group.save();

    return res.status(200).json({
      message: 'Member flags updated',
      member: {
        userId: String(member.user.ref),
        isAdmin: !!member.user.isAdmin,
        isPinned: !!member.user.isPinned,
        isMute: !!member.user.isMute,
        isOnline: !!member.user.isOnline,
        joinedAt: member.joinedAt,
      },
    });
  } catch (err) {
    return res
      .status(500)
      .json({ message: 'Failed to update member flags', error: err.message });
  }
};

