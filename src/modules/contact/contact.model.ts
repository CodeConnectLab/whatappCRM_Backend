import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { getModel } from '../../utils/registerModel.js';

const contactSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    phone: { type: String, required: true, trim: true },
    name: { type: String, trim: true },
    email: { type: String, trim: true, lowercase: true },
    tags: { type: [String], default: [] },
    meta: { type: Schema.Types.Mixed, default: {} },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

contactSchema.index({ companyId: 1, phone: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
contactSchema.index({ companyId: 1, name: 'text', phone: 'text' });

export type Contact = InferSchemaType<typeof contactSchema>;
export const ContactModel: Model<Contact> = getModel<Contact>('Contact', contactSchema);
