import mongoose from "mongoose";

const inviteSchema = new mongoose.Schema(
  {
    groupId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "Group", 
      required: true 
    },
    inviterUserId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User", 
      required: true 
    },
    recipientUserId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User" 
    },
    recipientEmail: String,
    recipientPhone: String,
    channel: { 
      type: String, 
      enum: ["EMAIL", "SMS"], 
      required: true 
    },
    status: { 
      type: String, 
      enum: ["PENDING", "ACCEPTED", "CANCELLED", "EXPIRED"], 
      default: "PENDING" 
    },
    acceptedAt: Date,
    acceptedByUserId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User" 
    },
  },{ timestamps: true });

// helpful lookups/dedup/analytics
inviteSchema.index({ groupId: 1, status: 1 });
inviteSchema.index({ groupId: 1, recipientEmail: 1, status: 1 });
inviteSchema.index({ groupId: 1, recipientPhone: 1, status: 1 });
inviteSchema.index({ groupId: 1, recipientUserId: 1, status: 1 });

export default mongoose.model("Invite", inviteSchema);
