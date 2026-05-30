import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { getModel } from '../../utils/registerModel.js';

export const CAMPAIGN_MESSAGE_STATUSES = ['pending', 'queued', 'sent', 'failed'] as const;

const campaignMessageSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    campaignId: { type: Schema.Types.ObjectId, ref: 'Campaign', required: true, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true },
    body: { type: String, required: true },
    mediaUrl: { type: String, trim: true },
    status: { type: String, enum: CAMPAIGN_MESSAGE_STATUSES, default: 'pending' },
    twilioSid: { type: String },
    error: { type: String },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

campaignMessageSchema.index({ campaignId: 1, contactId: 1 }, { unique: true });

export type CampaignMessage = InferSchemaType<typeof campaignMessageSchema>;
export const CampaignMessageModel: Model<CampaignMessage> = getModel<CampaignMessage>(
  'CampaignMessage',
  campaignMessageSchema,
);
