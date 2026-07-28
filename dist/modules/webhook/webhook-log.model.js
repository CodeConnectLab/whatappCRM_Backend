import { Schema } from 'mongoose';
import { getModel } from '../../utils/registerModel.js';
const webhookLogSchema = new Schema({
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', index: true },
    provider: { type: String, required: true, default: 'twilio' },
    path: { type: String, required: true },
    payload: { type: Schema.Types.Mixed, required: true },
    headers: { type: Schema.Types.Mixed },
    signatureValid: { type: Boolean },
}, { timestamps: true });
webhookLogSchema.index({ createdAt: -1 });
export const WebhookLogModel = getModel('WebhookLog', webhookLogSchema);
