import cron from 'node-cron';
import Otp from '../models/Otp.js'
import { log, error } from '../utils/logger.js';

export const scheduleOtpCleanup = () => {
    cron.schedule('58 1 * * *', async () => {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);

        try {
            const result = await Otp.deleteMany({
                createdAt: {
                    $lt: cutoff
                }
            });
            log(` OTP Cleanup: Deleted ${result.deletedCount} expired OTPs`);
        } catch (err) {
            error('OTP Cleanup Failed...', err);
        }
    });
};