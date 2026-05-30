import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { getModel } from '../../utils/registerModel.js';

export const CAMPAIGN_STATUSES = [
  'draft',
  'scheduled',
  'running',
  'paused',
  'completed',
  'failed',
] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

const campaignSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    name: { type: String, required: true, trim: true },
    status: { type: String, enum: CAMPAIGN_STATUSES, default: 'draft' },
    templateId: { type: Schema.Types.ObjectId, ref: 'Template' },
    whatsappNumberId: { type: Schema.Types.ObjectId, ref: 'WhatsappNumber', required: true },
    contactGroupIds: { type: [{ type: Schema.Types.ObjectId, ref: 'ContactGroup' }], default: [] },
    contactIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Contact' }], default: [] },
    scheduledAt: { type: Date },
    stats: {
      total: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
    },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

campaignSchema.index({ companyId: 1, status: 1 });
campaignSchema.index({ companyId: 1, createdAt: -1 });

export type Campaign = InferSchemaType<typeof campaignSchema>;
export const CampaignModel: Model<Campaign> = getModel<Campaign>('Campaign', campaignSchema);
