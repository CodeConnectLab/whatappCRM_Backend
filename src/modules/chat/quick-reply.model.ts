import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { getModel } from '../../utils/registerModel.js';

/**
 * Canned message an agent can drop into the composer.
 *
 * Distinct from a WhatsApp template: a quick reply is ours, needs no Meta approval and
 * is only deliverable inside the 24-hour window. It exists so an agent answering the
 * same question forty times a day types it once.
 */
const quickReplySchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    title: { type: String, required: true, trim: true },
    body: { type: String, required: true, trim: true },
    /** Typed as "/price" in the composer to insert it without opening the picker. */
    shortcut: { type: String, trim: true, lowercase: true },
    /** Optional attachment sent with the reply — a price list, a brochure. */
    mediaId: { type: Schema.Types.ObjectId, ref: 'Media' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User' },
    /** Book-keeping so an admin can see which replies earn their place. */
    useCount: { type: Number, default: 0 },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

quickReplySchema.index(
  { companyId: 1, title: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } },
);

export type QuickReply = InferSchemaType<typeof quickReplySchema>;
export const QuickReplyModel: Model<QuickReply> = getModel<QuickReply>(
  'QuickReply',
  quickReplySchema,
);
