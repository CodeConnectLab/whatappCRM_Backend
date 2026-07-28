import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { getModel } from '../../utils/registerModel.js';

const metaWhatsappConfigSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, unique: true, index: true },
    /** Long-lived System User or permanent token from Meta Business. */
    accessTokenEncrypted: { type: String },
    /** App Secret from Meta Developer → App Settings → Basic (per tenant Meta app). */
    appSecretEncrypted: { type: String },
    /** Plain verify token — client pastes the same value in Meta webhook configuration. */
    webhookVerifyToken: { type: String, trim: true },
    /** Public path segment: /webhooks/meta/whatsapp/:webhookSlug */
    webhookSlug: { type: String, trim: true, unique: true, sparse: true },
    webhookVerificationStatus: {
      type: String,
      enum: ['pending', 'verified', 'failed'],
      default: 'pending',
    },
    webhookVerifiedAt: { type: Date },
    webhookLastVerifyAt: { type: Date },
    webhookLastVerifyError: { type: String, trim: true },
    wabaId: { type: String, trim: true },
    /**
     * Meta App ID. Only needed to upload template header images (Resumable Upload
     * API); auto-detected from the access token when left blank.
     */
    appId: { type: String, trim: true },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

metaWhatsappConfigSchema.index(
  { webhookVerifyToken: 1 },
  { unique: true, sparse: true, partialFilterExpression: { webhookVerifyToken: { $type: 'string' } } },
);

export type MetaWhatsappConfig = InferSchemaType<typeof metaWhatsappConfigSchema>;
export const MetaWhatsappConfigModel: Model<MetaWhatsappConfig> = getModel<MetaWhatsappConfig>(
  'MetaWhatsappConfig',
  metaWhatsappConfigSchema,
);
