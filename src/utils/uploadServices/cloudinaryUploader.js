import { v2 as cloudinary } from 'cloudinary';
import fs from 'fs';
import { log, error } from '../logger.js';

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_NAME,
    api_key: process.env.CLOUDINARY_KEY,
    api_secret: process.env.CLOUDINARY_SECRET
});

export const uploadMusicFile = async (file) => {
    try {
        const result = await cloudinary.uploader.upload(file.path, {
            resource_type: 'video',
            folder: 'music_uploads'
        });

        log(`File uploaded to Cloudinary: ${result.secure_url}`);

        fs.unlink(file.path, (err) => {
            if(err) {
                error('temp file deleted failed.', err);
            } else {
                log(`temp file deleted ${file.path}`);
            }
        });

        return {
            url: result.secure_url,
            publicId: result.public_id
        };
    } catch (err) {
        error('Cloudnary upload failed', err);
        throw err;
    }
};

//profile Pic upload to cloud

export const uploadImageFile = async (file) => {
    try {
        const result= await cloudinary.uploader.upload(file.path, {
            resource_type:'image',
            folder: 'profile_pics'
        });

        //clean temp
                fs.unlink(file.path, (err) => {
            if(err) {
                error('temp file deleted failed.', err);
            } else {
                log(`temp file deleted ${file.path}`);
            }
        });

        return {
            url: result.secure_url,
            publicId: result.public_id
        };
    } catch (err) {
        throw err;
    }
};

export const groupImageFile = async (file) => {
    try {
        const result= await cloudinary.uploader.upload(file.path, {
            resource_type:'image',
            folder: 'group_pics'
        });

        //clean temp
                fs.unlink(file.path, (err) => {
            if(err) {
                error('temp file deleted failed.', err);
            } else {
                log(`temp file deleted ${file.path}`);
            }
        });

        return {
            url: result.secure_url,
            publicId: result.public_id
        };
    } catch (err) {
        throw err;
    }
};