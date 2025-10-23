import mongoose from "mongoose";

const groupLinkSchema = new mongoose.Schema(
  {
    groupId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "Group", 
      required: true, 
      unique: true 
    },
    createdByUserId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true 
    },
    token: { 
      type: String, 
      required: true, 
      unique: true 
    },
    isActive: { 
      type: Boolean, 
      default: true 
    },
    expiresAt: Date,
  },{ timestamps: true });

export default mongoose.model("GroupLink", groupLinkSchema);
