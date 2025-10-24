import mongoose from "mongoose";

const { Schema, model } = mongoose;

const QueueItemSchema = new Schema(
  {
    id: { type: String, required: true },          // client uses this for move/remove
    trackUrl: { type: String, required: true },
    title: { type: String, default: "" },
    artist: { type: String, default: "" },
    durationSec: { type: Number },
  },
  { _id: false }
);

const MemberSchema = new Schema(
  {
    user: {
      ref: { type: Schema.Types.ObjectId, ref: "User", required: true },
      isAdmin: { type: Boolean, default: false },
      isMute: { type: Boolean, default: false },
      isPinned: { type: Boolean, default: false },
      isOnline: { type: Boolean, default: false },
    },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const GroupSchema = new Schema(
  {
    groupName: { type: String, required: true },
    groupSubtitle: { type: String, default: "" },
    groupCode: { type: String, required: true, unique: true },
    groupImage: { type: String },
    groupImagePublicId: { type: String },

    members: { type: [MemberSchema], default: [] },

    playback: {
      trackUrl: { type: String, default: null },
      isPlaying: { type: Boolean, default: false },
      startAtServerMs: { type: Number, default: 0 },
      startOffsetSec: { type: Number, default: 0 },
      updatedBy: { type: Schema.Types.ObjectId, ref: "User" },
    },

    // ✅ normalized queue shape (plural `items`)
    queue: {
      items: { type: [QueueItemSchema], default: [] },
      currentIndex: { type: Number, default: -1 },
      version: { type: Number, default: 0 },
      history: { type: Array, default: [] },
    },

    settings: {
      allowListenerEnqueue: { type: Boolean, default: true },
    },
  },
  { timestamps: true }
);

// Defensive normalization (handles any lingering legacy docs safely)
GroupSchema.pre("validate", function normalizeQueue() {
  this.queue = this.queue || {};
  if (!Array.isArray(this.queue.items)) this.queue.items = [];
  if (typeof this.queue.currentIndex !== "number") this.queue.currentIndex = -1;
  if (typeof this.queue.version !== "number") this.queue.version = 0;
  if (!Array.isArray(this.queue.history)) this.queue.history = [];
});

export default model("Group", GroupSchema);
