import { Schema } from 'mongoose';
import { getModel } from '../../utils/registerModel.js';
const mediaSchema = new Schema({
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    key: { type: String, required: true },
    url: { type: String, required: true },
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    uploadedBy: { type: Schema.Types.ObjectId, ref: 'User' },
    deletedAt: { type: Date },
}, { timestamps: true });
mediaSchema.index({ companyId: 1, key: 1 }, { unique: true });
export const MediaModel = getModel('Media', mediaSchema);
