// src/routes/playlistRoutes.js
import express from "express";
import {
  createPlaylist,
  getPlaylist,
  listPlaylists,
  updatePlaylist,
  deletePlaylist,
  joinPlaylist,
  leavePlaylist,
  addTrack,
  updateTrack,
  removeTrack,
  reorderTracks,
} from "../controllers/playlistController.js";
import { protect } from "../middlewares/authMiddleware.js";

const router = express.Router();

// --- Playlist CRUD ---
router.post("/create", protect, createPlaylist);
router.get("/all", protect, listPlaylists);
router.get("/single/:id", protect, getPlaylist);
router.patch("/update/:id", protect, updatePlaylist);
router.delete("/delete/:id", protect, deletePlaylist);

// --- Membership ---
router.post("/:id/join", protect, joinPlaylist);
router.delete("/:id/leave", protect, leavePlaylist);

// --- Tracks ---
router.post("/:id/addtracks", protect, addTrack);
router.patch("/:id/updatetracks/:trackId", protect, updateTrack);
router.delete("/:id/removetracks/:trackId", protect, removeTrack);
router.patch("/:id/reordertracks/reorder", protect, reorderTracks);

export default router;
