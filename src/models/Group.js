// src/models/Group.js
import mongoose from "mongoose";


const QueueItemSchema = new mongoose.Schema(
  {
    id: { 
      type: String, 
      required: true 
    },
    trackId: { 
      type: String, 
      default: null 
    },
    trackUrl: { 
      type: String, 
      required: true 
    },
    title: { 
      type: String, 
      default: "" 
    },
    artist: { 
      type: String, 
      default: "" 
    },
    durationSec: { 
      type: Number, 
      default: null 
    },
    addedBy: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User" 
    },
    addedAt: { 
      type: Date, 
      default: Date.now 
    },
    meta: { type: mongoose.Schema.Types.Mixed },
  },{ _id: false });

const QueueSchema = new mongoose.Schema(
  {
    item: { 
      type: [QueueItemSchema], 
      default: [] 
    },
    currentIndex: { 
      type: Number, 
      default: -1 
    },
    version: { 
      type: Number, 
      default: 0 
    },
    history: {
      type: [
        {
          id: String,
          title: String,
          artist: String,
          playedAt: Date,
        },
      ],
      default: [],
    },
  },
  { _id: false }
);

const Playbackschema = new mongoose.Schema(
  {
    trackUrl: { 
      type: String, 
      default: null 
    },
    isPlaying: { 
      type: Boolean, 
      default: false 
    },
    startAtServerMs: { 
      type: Number, 
      default: 0 
    },
    startoffsetSec: { 
      type: Number, 
      default: 0 
    },
    updatedBy: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User" 
    },
  },{ _id: false });


const UserWithFlagsSchema = new mongoose.Schema(
  {
    ref: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true 
    },
    isAdmin: { 
      type: Boolean, 
      default: false 
    },
    isMute: { 
      type: Boolean, 
      default: false 
    },
    isPinned: { 
      type: Boolean, 
      default: false 
    },
    isOnline: { 
      type: Boolean, 
      default: false 
    },
  },{ _id: false });

const MemberSchema = new mongoose.Schema(
  {
    user: { 
      type: UserWithFlagsSchema, 
      required: true 
    },
    joinedAt: { 
      type: Date, 
      default: Date.now 
    },
  },{ _id: false });

const groupSchema = new mongoose.Schema(
  {
    groupName: { 
      type: String, 
      required: true 
    },
    groupSubtitle: { 
      type: String, 
      required: true 
    },
    groupCode: { 
      type: String, 
      unique: true, 
      required: true 
    },
    groupImage: { 
      type: String, 
      default: "" 
    },
    groupImagePublicId: { 
      type: String, 
      default: "" 
    },

    members: {
      type: [MemberSchema],
      default: [],
    },

    playback: { 
      type: Playbackschema, 
      default: () => ({}) 
    },
    queue: { 
      type: QueueSchema, 
      default: () => ({}) 
    },

    settings: {
      allowListenerEnqueue: { 
        type: Boolean, 
        default: true 
      },
    },
  },{ timestamps: true });

// Helpful index for membership queries
groupSchema.index({ "members.user.ref": 1 });

// Convenience helpers (optional)
groupSchema.methods.isMember = function (userId) {
  const id = String(userId);
  return this.members.some((m) => String(m.user?.ref) === id);
};

groupSchema.methods.isAdmin = function (userId) {
  const id = String(userId);
  return this.members.some(
    (m) => String(m.user?.ref) === id && m.user?.isAdmin === true
  );
};

export default mongoose.model("Group", groupSchema);
