import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { getModel } from '../../utils/registerModel.js';

const twilioAccountSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    accountSid: { type: String, required: true, trim: true },
    authTokenEncrypted: { type: String, required: true },
    friendlyName: { type: String, trim: true },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

twilioAccountSchema.index({ companyId: 1, accountSid: 1 }, { unique: true });

export type TwilioAccount = InferSchemaType<typeof twilioAccountSchema>;
export const TwilioAccountModel: Model<TwilioAccount> = getModel<TwilioAccount>(
  'TwilioAccount',
  twilioAccountSchema,
);
