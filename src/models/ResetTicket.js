import mongoose from 'mongoose';

const resetTicketSchema = new mongoose.Schema(
  {
    jti: { 
        type: String, 
        required: true, 
        unique: true 
    }, 
    userId: { 
        type: mongoose.Schema.Types.ObjectId, 
        ref: 'User', 
        required: true 
    },
    purpose: { 
        type: String, 
        enum: ['reset_password'], 
        required: true 
    },   
    expiresAt: { 
        type: Date, 
        required: true 
    },    
    rootExpiresAt: { 
        type: Date, 
        required: true 
    },
    used: { 
        type: Boolean, 
        default: false 
    },
    createdAt: { 
        type: Date, 
        default: Date.now 
    },
  },{ versionKey: false });


resetTicketSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
resetTicketSchema.index({ userId: 1, purpose: 1, used: 1, expiresAt: 1 });

export default mongoose.model('ResetTicket', resetTicketSchema);