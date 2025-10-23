import cron from 'node-cron';
import fs from 'fs';
import path from 'path';
import { log, error } from '../utils/logger.js';

const TEMP_DIR = path.resolve('temp');

export const scheduleTempCleanup = () => {
    cron.schedule('55 1 * * *', () => {
        log('Starting temp file cleanup...');

        fs.readdir(TEMP_DIR, (err, files) => {
            if (err) {
                error('Filed to read temp directory:', err);
                return;
            }

            const now = Date.now();
            const DAY_MS =  24 * 60 * 60 * 1000;

            files.forEach((file) => {
                const filePath = path.join(TEMP_DIR, file);

                fs.stat(filePath, (err, stats) => {
                    if (err) {
                        error(`Could not access ${filePath}`, err);
                        return;
                    }
                    if ((now - stats.mtimeMs) > DAY_MS) {
                        fs.unlink(filePath, (err) => {
                            if (err) {
                                error(`Failed to Delete: ${filePath} `, err);
                            } else {
                                log(`Deleted old temp: ${filePath}`);
                            }
                        });
                    }
                });
            });
        });
    });
};