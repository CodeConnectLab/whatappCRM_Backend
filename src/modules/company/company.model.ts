import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { getModel } from '../../utils/registerModel.js';

export const SUBSCRIPTION_PLANS = ['free', 'starter', 'professional', 'enterprise'] as const;
export const SUBSCRIPTION_STATUSES = ['trial', 'active', 'expired'] as const;
export const BILLING_CYCLES = ['monthly', 'quarterly', 'yearly'] as const;

/**
 * Operator-managed, edited directly in Mongo — there is no write API on purpose, so a
 * customer cannot extend their own term. `endDate` is the one field that decides access.
 */
const subscriptionSchema = new Schema(
  {
    plan: { type: String, enum: SUBSCRIPTION_PLANS, default: 'free' },
    status: { type: String, enum: SUBSCRIPTION_STATUSES, default: 'trial' },
    startDate: { type: Date, default: Date.now },
    endDate: { type: Date, default: () => new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
    userLimit: { type: Number, default: 3, min: [1, 'userLimit must be at least 1'] },
    /** Amount per billing cycle before tax. Shown in Settings; nothing bills off it. */
    priceAmount: { type: Number, default: 0, min: 0 },
    currency: { type: String, default: 'INR', trim: true },
    /** Applied to priceAmount for the displayed total. */
    gstPercent: { type: Number, default: 18, min: 0 },
    billingCycle: { type: String, enum: BILLING_CYCLES, default: 'monthly' },
    notes: { type: String, trim: true, default: '' },
  },
  { _id: false },
);

const companySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    /** Preferred messaging stack for new setup; each sender row also has `provider`. */
    whatsappProvider: {
      type: String,
      enum: ['twilio', 'meta'],
      default: 'twilio',
    },
    subscription: { type: subscriptionSchema, default: () => ({}) },
    settings: { type: Schema.Types.Mixed, default: {} },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

companySchema.index({ slug: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
companySchema.index({ 'subscription.status': 1 });
companySchema.index({ 'subscription.endDate': 1 });

export type CompanySubscription = InferSchemaType<typeof subscriptionSchema>;
export type Company = InferSchemaType<typeof companySchema>;
export const CompanyModel: Model<Company> = getModel<Company>('Company', companySchema);
