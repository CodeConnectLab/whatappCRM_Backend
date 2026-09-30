import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { getModel } from '../../utils/registerModel.js';

// 'sent' only ever meant "Meta accepted it". The delivery states come from the
// status webhook, and without them campaign reporting stops at acceptance.
export const CAMPAIGN_MESSAGE_STATUSES = [
  'pending',
  'queued',
  'sent',
  'delivered',
  'read',
  'failed',
] as const;

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
    /** What Meta charged, from the status webhook. Mirrors Message.billing. */
    billing: {
      billable: { type: Boolean },
      category: { type: String, trim: true },
      pricingModel: { type: String, trim: true },
      pricingType: { type: String, trim: true },
      recordedAt: { type: Date },
    },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

campaignMessageSchema.index({ campaignId: 1, contactId: 1 }, { unique: true });
/** Status webhooks arrive keyed on the Meta message id. */
campaignMessageSchema.index(
  { twilioSid: 1 },
  { sparse: true, partialFilterExpression: { twilioSid: { $type: 'string' } } },
);

export type CampaignMessage = InferSchemaType<typeof campaignMessageSchema>;
export const CampaignMessageModel: Model<CampaignMessage> = getModel<CampaignMessage>(
  'CampaignMessage',
  campaignMessageSchema,
);
