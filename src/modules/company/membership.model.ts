import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { getModel } from '../../utils/registerModel.js';

export const MEMBERSHIP_ROLES = ['company_admin', 'agent'] as const;
export type MembershipRole = (typeof MEMBERSHIP_ROLES)[number];

const membershipSchema = new Schema(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    role: { type: String, enum: MEMBERSHIP_ROLES, required: true },
    inviteTokenHash: { type: String },
    inviteExpires: { type: Date },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

membershipSchema.index(
  { userId: 1, companyId: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);

export type Membership = InferSchemaType<typeof membershipSchema>;
export const MembershipModel: Model<Membership> = getModel<Membership>('Membership', membershipSchema);
