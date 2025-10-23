import mongoose from "mongoose";

const deviceSchema = new mongoose.Schema(
  {
    deviceId: {
      type: String,
      required: true,
    },
    fcmToken: {
      type: String,
    },
    loginTime: {
      type: Date,
      default: Date.now,
    },
  },{ _id: false });

const userSchema = new mongoose.Schema(
  {
    fName: {
      type: String,
      trim: true,
      required: true,
    },
    lName: {
      type: String,
      trim: true,
      required: true,
    },
    mobileNo: {
      type: String,
      trim: true,
      unique: true,
      required: true,
    },

    email: {
      type: String,
      unique: true,
      required: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      required: true,
    },
    profilePic: {
      type: String,
    },
    profilePicPublicId: {
      type: String,
    },
    latitude: {
      type: Number,
    },
    longitude: {
      type: Number,
    },
    profileId: {
      type: String,
      unique: true,
      default: function () {
        const rand = Math.floor(100000000 + Math.random() * 900000000);
        return "1" + String(rand);
      },
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    devices: [deviceSchema],
  },{ timestamps: true });

export default mongoose.model("User", userSchema);
