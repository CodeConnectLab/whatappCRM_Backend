import { Schema, type HydratedDocument, type InferSchemaType, type Model } from 'mongoose';
import { getModel } from '../../utils/registerModel.js';

const userSchema = new Schema(
  {
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    isSuperAdmin: { type: Boolean, default: false },
    refreshTokenHashes: { type: [String], default: [] },
    passwordResetTokenHash: { type: String },
    passwordResetExpires: { type: Date },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

userSchema.index({ email: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });

export type User = InferSchemaType<typeof userSchema>;
export type UserDocument = HydratedDocument<User>;
export const UserModel: Model<User> = getModel<User>('User', userSchema);
