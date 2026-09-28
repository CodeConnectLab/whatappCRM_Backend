import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { getModel } from '../../utils/registerModel.js';

/**
 * first_inbound       — the lead's opening message (the classic welcome).
 * every_inbound       — every message from the contact, subject to the throttle.
 * keyword             — only when the message matches one of the rule's keywords.
 * outside_hours       — the opening message, but only outside business hours.
 * no_agent_reply      — nobody has replied within `delayMinutes` (a nudge).
 */
export const AUTO_RESPONSE_TRIGGERS = [
  'first_inbound',
  'every_inbound',
  'keyword',
  'outside_hours',
  'no_agent_reply',
] as const;
export type AutoResponseTrigger = (typeof AUTO_RESPONSE_TRIGGERS)[number];

export const AUTO_RESPONSE_ACTIONS = ['text', 'template'] as const;
export type AutoResponseAction = (typeof AUTO_RESPONSE_ACTIONS)[number];

/** How often one rule may fire for the same conversation. */
export const AUTO_RESPONSE_THROTTLES = ['once_per_chat', 'once_per_day', 'always'] as const;

const businessHoursSchema = new Schema(
  {
    /** IANA zone the window is expressed in, e.g. Asia/Kolkata. */
    timezone: { type: String, trim: true, default: 'Asia/Kolkata' },
    /** Minutes from midnight, so 9:30am is 570. */
    startMinute: { type: Number, default: 9 * 60 },
    endMinute: { type: Number, default: 19 * 60 },
    /** 0 = Sunday, matching JS getDay(). */
    weekdays: { type: [Number], default: [1, 2, 3, 4, 5, 6] },
  },
  { _id: false },
);

/**
 * One configurable auto-reply.
 *
 * Rules are evaluated in `priority` order and the first match wins, so a narrow
 * product-specific greeting can sit in front of a catch-all welcome without the lead
 * receiving both.
 */
const autoResponseSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    name: { type: String, required: true, trim: true },
    enabled: { type: Boolean, default: true },
    /** Lower runs first. */
    priority: { type: Number, default: 100 },
    trigger: { type: String, enum: AUTO_RESPONSE_TRIGGERS, default: 'first_inbound' },

    /* ---- match conditions. All that are set must hold. ---- */
    /** Restrict to leads matched to this product. */
    productId: { type: Schema.Types.ObjectId, ref: 'Product' },
    /** Restrict to these Meta ad / post ids. */
    adIds: { type: [String], default: [] },
    /** Restrict to ad headlines containing one of these fragments. */
    campaignNames: { type: [String], default: [] },
    /** Restrict to conversations on these senders. */
    whatsappNumberIds: { type: [{ type: Schema.Types.ObjectId, ref: 'WhatsappNumber' }], default: [] },
    /** Words the inbound message must contain (required for the keyword trigger). */
    keywords: { type: [String], default: [] },
    /** Only fire for leads that came from a paid ad (referral carries a ctwa_clid). */
    adLeadsOnly: { type: Boolean, default: false },
    businessHours: { type: businessHoursSchema, default: undefined },

    /* ---- what to send ---- */
    actionType: { type: String, enum: AUTO_RESPONSE_ACTIONS, default: 'text' },
    /** Body for a text action. Supports {{name}}, {{phone}}, {{product}}, {{agent}}. */
    body: { type: String, trim: true },
    /** Approved template for a template action — the only way to reply outside 24h. */
    templateId: { type: Schema.Types.ObjectId, ref: 'Template' },
    /** Attachment sent alongside the text (brochure, price list). */
    mediaId: { type: Schema.Types.ObjectId, ref: 'Media' },

    /** Wait before sending, so the reply does not land in the same instant. */
    delaySeconds: { type: Number, default: 0 },
    /** Minutes of silence before a no_agent_reply rule fires. */
    delayMinutes: { type: Number, default: 15 },
    throttle: { type: String, enum: AUTO_RESPONSE_THROTTLES, default: 'once_per_chat' },

    stats: {
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      lastSentAt: { type: Date },
      lastError: { type: String, trim: true },
    },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

autoResponseSchema.index({ companyId: 1, enabled: 1, priority: 1 });

export type AutoResponseRule = InferSchemaType<typeof autoResponseSchema>;
export const AutoResponseRuleModel: Model<AutoResponseRule> = getModel<AutoResponseRule>(
  'AutoResponseRule',
  autoResponseSchema,
);

/**
 * One row per (rule, chat) firing. The throttle is enforced here rather than with a
 * counter on the rule, because "once per chat" has to survive a restart and a webhook
 * redelivery.
 */
const autoResponseLogSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    ruleId: { type: Schema.Types.ObjectId, ref: 'AutoResponseRule', required: true },
    chatId: { type: Schema.Types.ObjectId, ref: 'Chat', required: true },
    messageId: { type: Schema.Types.ObjectId, ref: 'Message' },
    status: { type: String, enum: ['sent', 'failed'], required: true },
    error: { type: String, trim: true },
  },
  { timestamps: true },
);

autoResponseLogSchema.index({ companyId: 1, ruleId: 1, chatId: 1, createdAt: -1 });

export type AutoResponseLog = InferSchemaType<typeof autoResponseLogSchema>;
export const AutoResponseLogModel: Model<AutoResponseLog> = getModel<AutoResponseLog>(
  'AutoResponseLog',
  autoResponseLogSchema,
);
