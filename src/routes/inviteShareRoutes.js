import express from "express";
import { protect } from "../middlewares/authMiddleware.js";
import {
  createShareLink,
  resolveLink,
  joinGroupWithLink,
  sendInviteEmailController,
  sendInviteSmsController,
  inviteSearch,
  listPendingInvites
} from "../controllers/inviteShareController.js";

const router = express.Router();

// share link
router.post("/share", protect, createShareLink);

// resolve token (public)
router.get("/resolve/:token", resolveLink);

// join via token (auth)
router.post("/join", protect, joinGroupWithLink);

// send invites (auth)
router.post("/send/email", protect, sendInviteEmailController);
router.post("/send/sms", protect, sendInviteSmsController);
router.get("/search", protect, inviteSearch); //search

//List Pending Invites admin only
router.get("/:id/invites", protect, listPendingInvites);

export default router;
