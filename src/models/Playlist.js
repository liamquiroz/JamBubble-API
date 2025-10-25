// src/models/Playlist.js
import mongoose from "mongoose";

const { Schema, model, models, Types } = mongoose;

const TrackSchema = new Schema(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 200,
    },
    artwork: {
      type: String,
      trim: true,
    },
    trackUrl: {
      type: String,
      required: true,
      trim: true,
    },
    addedAt: {
      type: Date,
      default: Date.now,
    },
    addedBy: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
    },
  },
  { _id: true }
);

//Playlist
const PlaylistSchema = new Schema(
  {
    playlistTitle: {
      type: String,
      required: true,
      trim: true,
      minlength: 3,
      maxlength: 120,
    },
    playlistDescription: {
      type: String,
      trim: true,
      maxlength: 2000,
      default: "",
    },
    playlistImage: {
      type: String,
      trim: true,
    },
    playlistImgPublicId: {
      type: String,
    },
    admin: {
      type: Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    members: [
      {
        type: Types.ObjectId,
        ref: "User",
        index: true,
      },
    ],
    tracks: {
      type: [TrackSchema],
      default: [],
    },
    likesCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
    versionKey: false,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

PlaylistSchema.virtual("memberCount").get(function () {
  return Array.isArray(this.members) ? this.members.length : 0;
});

PlaylistSchema.virtual("trackCount").get(function () {
  return Array.isArray(this.tracks) ? this.tracks.length : 0;
});

//Indexes
PlaylistSchema.index({ admin: 1, playlistTitle: 1 }, { unique: true });
PlaylistSchema.index({ createdAt: -1 });
PlaylistSchema.index({ likesCount: -1 });

const Playlist = models.Playlist || model("Playlist", PlaylistSchema);
export default Playlist;
