import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { getModel } from '../../utils/registerModel.js';

const chatSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true },
    whatsappNumberId: { type: Schema.Types.ObjectId, ref: 'WhatsappNumber', required: true },
    lastMessageAt: { type: Date },
    lastMessagePreview: { type: String },
    unreadCount: { type: Number, default: 0 },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

chatSchema.index({ companyId: 1, contactId: 1, whatsappNumberId: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
chatSchema.index({ companyId: 1, lastMessageAt: -1 });

export type Chat = InferSchemaType<typeof chatSchema>;
export const ChatModel: Model<Chat> = getModel<Chat>('Chat', chatSchema);
