import { Schema } from 'mongoose';
import { getModel } from '../../utils/registerModel.js';
const contactGroupSchema = new Schema({
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    name: { type: String, required: true, trim: true },
    contactIds: { type: [{ type: Schema.Types.ObjectId, ref: 'Contact' }], default: [] },
    deletedAt: { type: Date },
}, { timestamps: true });
contactGroupSchema.index({ companyId: 1, name: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
export const ContactGroupModel = getModel('ContactGroup', contactGroupSchema);
