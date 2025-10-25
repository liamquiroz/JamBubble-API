import express from 'express';
import multer from 'multer';
import { protect } from '../middlewares/authMiddleware.js';

import {
    uploadTrack,
    getMyTrack,
    deleteTrack
} from "../controllers/musicController.js"

const router = express.Router();
const upload = multer({ dest: 'temp/'}); //temp folder

router.post('/upload', protect, upload.single('file'), uploadTrack);
router.get('/my-track', protect, getMyTrack);
router.delete('/:id', protect, deleteTrack);

export default router;