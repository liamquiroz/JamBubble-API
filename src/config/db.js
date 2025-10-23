import mongoose from "mongoose";
import { log, error } from "../utils/logger.js";

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        log('Database Connected...');
    } catch (err) {
        Error('database connection error', err);
        process.exit(1);
    }
};

export default connectDB;


