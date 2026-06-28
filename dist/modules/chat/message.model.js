import { Schema } from "mongoose";
import { getModel } from "../../utils/registerModel.js";
const MESSAGE_DIRECTIONS = ["inbound", "outbound"];
const MESSAGE_STATUSES = ["queued", "sent", "delivered", "read", "failed"];
const messageSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    chatId: { type: Schema.Types.ObjectId, ref: "Chat", required: true, index: true },
    direction: { type: String, enum: MESSAGE_DIRECTIONS, required: true },
    body: { type: String, required: true },
    status: { type: String, enum: MESSAGE_STATUSES, default: "queued" },
    /** Meta/Twilio delivery failure detail when status is failed. */
    statusDetail: { type: String, trim: true },
    twilioSid: { type: String },
    mediaId: { type: Schema.Types.ObjectId, ref: "Media" },
    senderUserId: { type: Schema.Types.ObjectId, ref: "User" },
    deletedAt: { type: Date }
  },
  { timestamps: true }
);
messageSchema.index({ chatId: 1, createdAt: -1 });
messageSchema.index(
  { twilioSid: 1 },
  { unique: true, sparse: true, partialFilterExpression: { twilioSid: { $type: "string" } } }
);
const MessageModel = getModel("Message", messageSchema);
export {
  MESSAGE_DIRECTIONS,
  MESSAGE_STATUSES,
  MessageModel
};
