import { Schema } from 'mongoose';
import { getModel } from '../../utils/registerModel.js';
const userSchema = new Schema({
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    isSuperAdmin: { type: Boolean, default: false },
    refreshTokenHashes: { type: [String], default: [] },
    passwordResetTokenHash: { type: String },
    passwordResetExpires: { type: Date },
    deletedAt: { type: Date },
}, { timestamps: true });
userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
export const UserModel = getModel('User', userSchema);
