import { Schema } from 'mongoose';
import { getModel } from '../../utils/registerModel.js';
const twilioAccountSchema = new Schema({
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    accountSid: { type: String, required: true, trim: true },
    authTokenEncrypted: { type: String, required: true },
    friendlyName: { type: String, trim: true },
    deletedAt: { type: Date },
}, { timestamps: true });
twilioAccountSchema.index({ companyId: 1, accountSid: 1 }, { unique: true });
export const TwilioAccountModel = getModel('TwilioAccount', twilioAccountSchema);
