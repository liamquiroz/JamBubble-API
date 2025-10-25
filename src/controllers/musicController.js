import Music from "../models/Music.js";
import { uploadMusicFile } from "../utils/uploadServices/cloudinaryUploader.js";
import { v2 as cloudinary } from "cloudinary";

//upload track
export const uploadTrack = async (req, res) => {
    const { title, genre, album, artist } = req.body;

    if(!req.file) {
        return res.status(400).json({ message: 'No Music file uploaded' });
    }

    if(!title) {
        return res.status(400).json({ message: 'Track Title is required' });
    }

    try {
        const { url, publicId } = await uploadMusicFile(req.file);
        const track = await Music.create({
            userId: req.user.id,
            title,
            genre,
            album,
            artist,
            fileUrl: url,
            publicId,
            uploadedAt: new Date(),
        });

        res.status(200).json({ message: 'Track Uploaded successfully', track });
    } catch (error) {
        res.status(500).json({ message: 'Upload failed' });
    }
};

//get All track uploaded by user
export const getMyTrack = async (req, res) => {
    try {
        const tracks = await Music.find({ userId: req.user.id }).sort({ createdAt: -1 });
        res.status(200).json({ tracks });
    } catch (error) {
        res.status(500).json({ message: 'Failed to fetch tracks'});
    }
};

//Delete Track
export const deleteTrack = async (req, res) => {
    try {
        const track = await Music.findOne({ _id: req.params.id, userId: req.user.id });
        if (!track) return res.status(404).json({ message: 'Track not found'});

        //Delete from cloudinary
        if (track.publicId) {
            await cloudinary.uploader.destroy(track.publicId, { resource_type: "video"});
        }

        await track.deleteOne();
        res.status(200).json({ message: 'Track Deleted Successfully'});
    } catch (error) {
        res.status(500).json({ message: 'Error Delete Track'});
    }
};