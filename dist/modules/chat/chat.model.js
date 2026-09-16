import { Schema } from 'mongoose';
import { getModel } from '../../utils/registerModel.js';
export const CRM_SYNC_STATUSES = ['pending', 'synced', 'duplicate', 'skipped', 'failed'];
/**
 * First-touch ad attribution for the whole conversation.
 *
 * Meta sends the referral once, on the opening message; copying it onto the chat keeps
 * "this lead came from ad X" answerable without walking back through the message log.
 */
const chatReferralSchema = new Schema({
    ctwaClid: { type: String, trim: true },
    sourceId: { type: String, trim: true },
    sourceType: { type: String, trim: true },
    sourceUrl: { type: String, trim: true },
    headline: { type: String, trim: true },
    adBody: { type: String, trim: true },
    mediaType: { type: String, trim: true },
    imageUrl: { type: String, trim: true },
    videoUrl: { type: String, trim: true },
    thumbnailUrl: { type: String, trim: true },
    capturedAt: { type: Date },
}, { _id: false });
const chatSchema = new Schema({
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true },
    whatsappNumberId: { type: Schema.Types.ObjectId, ref: 'WhatsappNumber', required: true },
    lastMessageAt: { type: Date },
    lastMessagePreview: { type: String },
    unreadCount: { type: Number, default: 0 },
    /** Ad/post this conversation originated from, captured once at first contact. */
    referral: { type: chatReferralSchema, default: undefined },
    /** Text of the very first inbound message — the lead's own words, pushed to the CRM. */
    firstInboundMessage: { type: String, trim: true },
    firstInboundAt: { type: Date },
    /** Outcome of the push to the external CRM; absent when the bridge is off. */
    crmSyncStatus: { type: String, enum: CRM_SYNC_STATUSES },
    crmLeadId: { type: String, trim: true },
    crmSyncedAt: { type: Date },
    crmSyncError: { type: String, trim: true },
    crmSyncAttempts: { type: Number, default: 0 },
    deletedAt: { type: Date },
}, { timestamps: true });
chatSchema.index({ companyId: 1, contactId: 1, whatsappNumberId: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
chatSchema.index({ companyId: 1, lastMessageAt: -1 });
/** Retry sweeps and "which leads failed to reach the CRM" views. */
chatSchema.index({ companyId: 1, crmSyncStatus: 1 }, { sparse: true, partialFilterExpression: { crmSyncStatus: { $type: 'string' } } });
export const ChatModel = getModel('Chat', chatSchema);
