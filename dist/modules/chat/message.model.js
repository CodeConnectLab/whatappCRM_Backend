import { Schema } from 'mongoose';
import { getModel } from '../../utils/registerModel.js';
export const MESSAGE_DIRECTIONS = ['inbound', 'outbound'];
export const MESSAGE_STATUSES = ['queued', 'sent', 'delivered', 'read', 'failed'];
/** Ad attribution Meta attaches to the first inbound message of a CTWA conversation. */
const referralSchema = new Schema({
    /** Click id from the ad tap; the key the Conversions API needs to close the loop. */
    ctwaClid: { type: String, trim: true },
    /** Ad id when sourceType is "ad", post id when it is "post". */
    sourceId: { type: String, trim: true },
    sourceType: { type: String, trim: true },
    sourceUrl: { type: String, trim: true },
    headline: { type: String, trim: true },
    adBody: { type: String, trim: true },
    mediaType: { type: String, trim: true },
    imageUrl: { type: String, trim: true },
    videoUrl: { type: String, trim: true },
    thumbnailUrl: { type: String, trim: true },
}, { _id: false });
/**
 * Attachment travelling with a message.
 *
 * The object `key` is the durable part; the browser-facing URL is minted per request
 * as a short-lived presigned GET, so the bucket never has to be public and a leaked
 * link expires on its own.
 */
const messageMediaSchema = new Schema({
    mediaId: { type: Schema.Types.ObjectId, ref: 'Media' },
    key: { type: String, trim: true },
    /** Fallback for attachments that live outside our storage (e.g. an ad thumbnail). */
    url: { type: String, trim: true },
    mimeType: { type: String, trim: true },
    filename: { type: String, trim: true },
    size: { type: Number },
    /** WhatsApp bucket the attachment is sent as. */
    kind: { type: String, enum: ['image', 'video', 'audio', 'document', 'sticker'] },
}, { _id: false });
const messageSchema = new Schema({
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    chatId: { type: Schema.Types.ObjectId, ref: 'Chat', required: true, index: true },
    direction: { type: String, enum: MESSAGE_DIRECTIONS, required: true },
    // Not required: a bare image or voice note has no text of its own.
    body: { type: String, default: '' },
    /** Raw WhatsApp message type: text, image, button, interactive, location, … */
    messageType: { type: String, trim: true, default: 'text' },
    status: { type: String, enum: MESSAGE_STATUSES, default: 'queued' },
    /** Meta/Twilio delivery failure detail when status is failed. */
    statusDetail: { type: String, trim: true },
    twilioSid: { type: String },
    /** Present only on the first message of an ad-sourced conversation. */
    referral: { type: referralSchema, default: undefined },
    mediaId: { type: Schema.Types.ObjectId, ref: 'Media' },
    media: { type: messageMediaSchema, default: undefined },
    /** True when an auto-response rule produced this message, not a person. */
    isAutomated: { type: Boolean, default: false },
    /** Rule that generated it, for the automation's own stats. */
    autoResponseRuleId: { type: Schema.Types.ObjectId, ref: 'AutoResponseRule' },
    /** Meta media id for inbound attachments (download via the Graph API when needed). */
    metaMediaId: { type: String, trim: true },
    senderUserId: { type: Schema.Types.ObjectId, ref: 'User' },
    deletedAt: { type: Date },
}, { timestamps: true });
messageSchema.index({ chatId: 1, createdAt: -1 });
messageSchema.index({ twilioSid: 1 }, { unique: true, sparse: true, partialFilterExpression: { twilioSid: { $type: 'string' } } });
/** Attribution lookups: "which conversations came from ad X". */
messageSchema.index({ companyId: 1, 'referral.sourceId': 1 }, { sparse: true, partialFilterExpression: { 'referral.sourceId': { $type: 'string' } } });
export const MessageModel = getModel('Message', messageSchema);
