import mongoose from "mongoose";
import { uploadImageFile } from "../utils/uploadServices/cloudinaryUploader.js";
import { v2 as cloudinary } from "cloudinary";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import Music from "../models/Music.js";
import Group from "../models/Group.js";
import { error, log } from "../utils/logger.js";

//helpers
const toClient = (u) => ({
  _id: u._id,
  fName: u.fName,
  lName: u.lName,
  email: u.email,
  mobileNo: u.mobileNo,
  profileId: u.profileId,
  profilePic: u.profilePic,         
  latitude: u.latitude,
  longitude: u.longitude,
  updatedAt: u.updatedAt,            
});

const etagFor = (u) =>
  `"user:${u._id}:${new Date(u.updatedAt || Date.now()).getTime()}"`;

//helper for cloud bulk delete
const _chunk = (arr, size = 100) => {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
};

//Upload profile picture
export const uploadProfilePic = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: "No Image uploaded." });

    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User not found" });

    // remove old image
    if (user.profilePicPublicId) {
      try {
        await cloudinary.uploader.destroy(user.profilePicPublicId, { resource_type: "image" });
      } catch (_) {}
    }

    // upload new image
    const { url, publicId } = await uploadImageFile(req.file);
    user.profilePic = url;
    user.profilePicPublicId = publicId;
    await user.save();

    const payload = toClient(user);
    res
      .status(200)
      .set("ETag", etagFor(user))
      .set("Last-Modified", new Date(user.updatedAt).toUTCString())
      .json({ message: "Profile picture updated", user: payload });
  } catch (err) {
    res.status(500).json({ message: "Upload failed", error: err.message });
  }
};

//Get user full profile
export const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.id)
      .select("fName lName email mobileNo profileId profilePic latitude longitude updatedAt");

    if (!user) return res.status(404).json({ message: "User Not Found" });

    const etag = etagFor(user);
    const lastMod = new Date(user.updatedAt).toUTCString();

    // Conditional GET
    const inm = req.headers["if-none-match"];
    const ims = req.headers["if-modified-since"];
    if ((inm && inm === etag) || (ims && new Date(ims) >= new Date(user.updatedAt))) {
      return res.status(304).set("ETag", etag).set("Last-Modified", lastMod).end();
    }

    res
      .status(200)
      .set("ETag", etag)
      .set("Last-Modified", lastMod)
      .json({ user: toClient(user) });
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch profile", error: err.message });
  }
};

//Update profile
export const updateUserProfile = async (req, res) => {
  try {
    const { fName, lName, latitude, longitude, newPassword } = req.body;
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: "User Not Found" });

    if (typeof fName === "string") user.fName = fName;
    if (typeof lName === "string") user.lName = lName;
    if (latitude !== undefined) user.latitude = latitude;
    if (longitude !== undefined) user.longitude = longitude;
    if (newPassword) user.password = await bcrypt.hash(newPassword, 10);

    await user.save();

    const payload = toClient(user);
    res
      .status(200)
      .set("ETag", etagFor(user))
      .set("Last-Modified", new Date(user.updatedAt).toUTCString())
      .json({ message: "Profile Updated", user: payload });
  } catch (err) {
    res.status(500).json({ message: "Profile Update Failed", error: err.message });
  }
};

//Delete User from DB + Cloud File also
export const deleteMyAccount = async (req, res) => {
  const userId = req.user?.id || req.user?._id;
  if (!userId) return res.status(401).json({ message: "Unauthorized" });

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const user = await User.findById(userId).session(session);
    if (!user) {
      await session.abortTransaction();
      return res.status(404).json({ message: "User Not Found"});
    }

    const tracks = await Music.find({ userId }, "publicId").session(session);
    const trackPublicIds = tracks.map(t => t.publicId).filter(Boolean);

    const adminGroup = await Group.find(
      {"members.user.ref": userId, "members.user.isAdmin": true}, "members groupImagePublicId"
    ).session(session);

    const soleAdminGroupIds = [];
    const soleAdminGroupImagePublicIds = [];

    for (const g of adminGroup) {
      const admins = (g.members || []).filter(m => m?.user?.isAdmin === true);
      const isOnlyAdmin = admins.length === 1 && String(admins[0]?.user?.ref) === String(userId);
      if (isOnlyAdmin) {
        soleAdminGroupIds.push(g._id);
        if (g.groupImagePublicId) {
          soleAdminGroupImagePublicIds.push(g.groupImagePublicId);
        }
      }
    }

    const cloud = {
      tracksDeleted: 0,
      tracksFailed: 0,
      profilePicDeleted: false,
      groupImagesDeleted: 0,
      groupImagesFailed: 0,
    };

    for (const batch of _chunk(trackPublicIds, 100)) {
      try {
        const resp = await cloudinary.api.delete_resources(batch, {
          resource_type: "video",
        });
        const deletedCount = Object.values(resp?.deleted || {}).filter(v => v === "deleted").length;
        cloud.tracksDeleted += deletedCount;
        cloud.tracksFailed += batch.length - deletedCount;

      } catch {
        cloud.tracksFailed += batch.length;
      }
    }

    if (user.profilePicPublicId) {
      try {
        const resp = await cloudinary.uploader.destroy(user.profilePicPublicId, {
          resource_type: "image",
        });
        cloud.profilePicDeleted = resp?.result === "ok";
      } catch {
        cloud.profilePicDeleted = false;
      }
    }

    for (const pid of soleAdminGroupImagePublicIds) {
      try {
        const resp = await cloudinary.uploader.destroy(pid, {resource_type: "image"});
        if (resp?.result === "ok") cloud.groupImagesDeleted += 1;
        else cloud.groupImagesFailed += 1;
      } catch {
        cloud.groupImagesFailed += 1;
      }
    }

    const musicDelRes = await Music.deleteMany({ userId}).session(session);

    let groupsDeleted = 0;
    if (soleAdminGroupIds.length) {
      const grpDelRes = await Group.deleteMany({ _id: { $in: soleAdminGroupIds } }).session(session);
      groupsDeleted = grpDelRes.deletedCount || 0;
    }

    const pullRes = await Group.updateMany(
      {"members.user.ref": userId},
      {
        $pull: {
          "members": { "user.ref": userId },
          "queue.item": { addedBy: userId },
        },
      }
    ).session(session);

    await Group.updateMany(
      {"playback.updatedBy": userId },
      {$set: {"playback.updatedBy": null}}
    ).session(session);

    await User.deleteOne({ _id: userId }).session(session);

    await session.commitTransaction();
    session.endSession();

    return res.status(200).json({
      ok: true,
      db: {
        musicDeleted: musicDelRes.deletedCount || 0,
        groupsDeleted,
        leftGroupsMatched: pullRes.matchedCount || 0,
        leftGroupModified: pullRes.modifiedCount || 0,
      },
      cloud,
      message: "Account and associated assets deleted.",
    });

  } catch (err) {
    await session.abortTransaction();
    session.endSession();
    error("delete Error", err);
    return res.status(500).json({
      ok: false,
      message: "Failed to delete account.",
    });
  }
};

export const fcmToken = async (req, res) => {
  try {
    const userId = req.user?.id || req.user?._id;
    const { deviceId, fcmToken } = req.body || {};

    if (!userId) return res.status(401).json({ message: "Unauthorized"});
    if (!deviceId || !fcmToken) {
      return res.status(400).json({ message: "deviceId and fcmToken are required" });
    }

    const updateExisting = await User.updateOne(
      { _id: userId, "devices.deviceId": deviceId},
      {
        $set: {
          "devices.$.fcmToken": fcmToken
        },
      }
    );

    if(updateExisting.matchedCount > 0) {
      return res.status(200).json({
        ok: true,
        updated: true,
        created: false,
        deviceId,
        message: 'fcm Token updated',
      });
    }

    const pushNew = await User.updateOne(
      {_id: userId},
      {
        $push:{
          devices: {
            deviceId,
            fcmToken,
          },
        },
      }
    );

    return res.status(201).json({
      ok: true,
      updated: false,
      created : pushNew.modifiedCount > 0,
      deviceId,
      message: "Fcm Token Registred",
    });
  } catch (err) {
    error("Fcm Token error", err);
    return res.status(500).json({
      ok: false,
      message: "Faild to registor fcm Token",
    });
  }
};