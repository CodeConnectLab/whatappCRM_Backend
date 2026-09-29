import { Schema } from 'mongoose';
import { getModel } from '../../utils/registerModel.js';
/**
 * Free-text note an agent leaves on a lead — call outcomes, budget, next steps.
 * Kept out of the message log on purpose: notes are internal and must never be
 * mistaken for something the contact can see.
 */
const chatNoteSchema = new Schema({
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    chatId: { type: Schema.Types.ObjectId, ref: 'Chat', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    body: { type: String, required: true, trim: true },
    deletedAt: { type: Date },
}, { timestamps: true });
chatNoteSchema.index({ chatId: 1, createdAt: -1 });
export const ChatNoteModel = getModel('ChatNote', chatNoteSchema);
