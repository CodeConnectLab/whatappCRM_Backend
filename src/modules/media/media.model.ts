import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { getModel } from '../../utils/registerModel.js';

const mediaSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    key: { type: String, required: true },
    url: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

mediaSchema.index({ companyId: 1, key: 1 }, { unique: true });

export type Media = InferSchemaType<typeof mediaSchema>;
export const MediaModel: Model<Media> = getModel<Media>('Media', mediaSchema);
