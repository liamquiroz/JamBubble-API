import mongoose from 'mongoose';

const otpSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true
    },
    otp: {
        type:String,
        required: true
    },
    type: {
        type:String,
        enum: ['signup', 'forgot-password'],
        required: true,

    }
}, { timestamps: true });

export default mongoose.model('Otp', otpSchema);