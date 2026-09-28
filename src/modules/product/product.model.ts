import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { getModel } from '../../utils/registerModel.js';

/**
 * A thing the workspace sells.
 *
 * Leads arrive with no product on them — only an ad id, a campaign headline or the
 * customer's own words. A product row is what turns those signals into something the
 * automation and the reports can key off: "this lead is about Solar Rooftop", so this
 * welcome message goes out and the CRM gets the right label.
 */
const productSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    /** Words in the lead's first message that point at this product, case-insensitive. */
    keywords: { type: [String], default: [] },
    /**
     * Meta ad / post ids (referral.source_id) that advertise this product. The strongest
     * signal available, because Meta sends it on the opening message of a CTWA chat.
     */
    adIds: { type: [String], default: [] },
    /** Ad headline fragments, for when the ad id is unknown but the creative is named. */
    campaignNames: { type: [String], default: [] },
    /** Senders dedicated to this product, when a workspace runs a number per brand. */
    whatsappNumberIds: { type: [{ type: Schema.Types.ObjectId, ref: 'WhatsappNumber' }], default: [] },
    /** Label pushed to the client's CRM instead of the raw ad headline. */
    crmLabel: { type: String, trim: true },
    active: { type: Boolean, default: true },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

productSchema.index(
  { companyId: 1, name: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);
productSchema.index({ companyId: 1, adIds: 1 });

export type Product = InferSchemaType<typeof productSchema>;
export const ProductModel: Model<Product> = getModel<Product>('Product', productSchema);
