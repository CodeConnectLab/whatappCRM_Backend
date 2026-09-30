import { Types } from 'mongoose';
import { AutoResponseLogModel, AutoResponseRuleModel, } from './auto-response.model.js';
import { ChatModel } from '../chat/chat.model.js';
import { ContactModel } from '../contact/contact.model.js';
import { MessageModel } from '../chat/message.model.js';
import { ProductModel } from '../product/product.model.js';
import { TemplateModel } from '../template/template.model.js';
import { WhatsappNumberModel } from '../twilio/whatsapp-number.model.js';
import { UserModel } from '../user/user.model.js';
import { sendOutboundChatMessage } from '../chat/chat.service.js';
import { sendWhatsappTemplateMessage } from '../messaging/messaging.service.js';
import { debitCredits, getCreditPerMessage } from '../wallet/wallet.service.js';
import { buildParameterValues } from '../template/template.service.js';
import { applyTemplate } from '../../utils/templateRender.js';
import { emitToCompany } from '../../socket/io.js';
import { logger } from '../../utils/logger.js';
function containsAny(haystack, needles) {
    const hay = haystack.toLowerCase();
    return needles.some((n) => {
        const needle = n?.trim().toLowerCase();
        return Boolean(needle) && hay.includes(needle);
    });
}
/**
 * Local wall-clock minutes and weekday in a given IANA zone.
 *
 * `Intl` is used rather than a date library because it is the only thing in the runtime
 * that knows the zone's current offset, DST included.
 */
function localTimeIn(timezone, at) {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        hour: '2-digit',
        minute: '2-digit',
        weekday: 'short',
        hour12: false,
    });
    const parts = fmt.formatToParts(at);
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    const weekdayName = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun';
    const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return {
        // 24 is what Intl reports for midnight with hour12: false.
        minute: (hour % 24) * 60 + minute,
        weekday: Math.max(0, weekdays.indexOf(weekdayName)),
    };
}
function withinBusinessHours(rule, at) {
    const bh = rule.businessHours;
    if (!bh)
        return true;
    const tz = bh.timezone?.trim() || 'Asia/Kolkata';
    let local;
    try {
        local = localTimeIn(tz, at);
    }
    catch {
        logger.warn('Auto-response: unknown timezone, treating as always open', { tz });
        return true;
    }
    const days = bh.weekdays?.length ? bh.weekdays : [0, 1, 2, 3, 4, 5, 6];
    if (!days.includes(local.weekday))
        return false;
    const start = bh.startMinute ?? 0;
    const end = bh.endMinute ?? 24 * 60;
    // An end before the start means the window crosses midnight (e.g. 20:00–02:00).
    if (end < start)
        return local.minute >= start || local.minute < end;
    return local.minute >= start && local.minute < end;
}
async function throttleAllows(rule, ctx) {
    const throttle = rule.throttle ?? 'once_per_chat';
    if (throttle === 'always')
        return true;
    const filter = {
        companyId: new Types.ObjectId(ctx.companyId),
        ruleId: rule._id,
        chatId: new Types.ObjectId(ctx.chatId),
        status: 'sent',
    };
    if (throttle === 'once_per_day') {
        filter.createdAt = { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) };
    }
    const already = await AutoResponseLogModel.exists(filter);
    return !already;
}
function triggerMatches(rule, ctx) {
    const trigger = rule.trigger;
    switch (trigger) {
        case 'first_inbound':
            return ctx.isFirstInbound;
        case 'every_inbound':
            return true;
        case 'keyword':
            return Boolean(rule.keywords?.length) && containsAny(ctx.messageBody, rule.keywords ?? []);
        case 'outside_hours':
            // The window describes when the office is OPEN, so this trigger is its complement —
            // and it is an opening-message greeting ("we're closed, we'll call you"), not a
            // reply to every message someone sends overnight.
            return ctx.isFirstInbound && !withinBusinessHours(rule, new Date());
        case 'no_agent_reply':
            // Driven by the follow-up sweep, never by an inbound message.
            return false;
        default:
            return false;
    }
}
function conditionsMatch(rule, ctx) {
    if (rule.adLeadsOnly && !ctx.isAdLead)
        return false;
    if (rule.productId && String(rule.productId) !== (ctx.productId ?? ''))
        return false;
    if (rule.adIds?.length) {
        const adId = ctx.adSourceId?.trim();
        if (!adId || !rule.adIds.some((id) => id.trim() === adId))
            return false;
    }
    if (rule.campaignNames?.length) {
        if (!ctx.adHeadline || !containsAny(ctx.adHeadline, rule.campaignNames))
            return false;
    }
    if (rule.whatsappNumberIds?.length) {
        if (!rule.whatsappNumberIds.some((id) => String(id) === ctx.whatsappNumberId))
            return false;
    }
    // Keywords narrow every trigger, not just the keyword one, so a welcome message can
    // be limited to leads who mention a term.
    if (rule.trigger !== 'keyword' && rule.keywords?.length) {
        if (!containsAny(ctx.messageBody, rule.keywords))
            return false;
    }
    // `outside_hours` uses the window as its trigger; every other trigger treats it as a
    // gate, so an office-hours welcome does not fire at 3am.
    if (rule.trigger !== 'outside_hours' && !withinBusinessHours(rule, new Date()))
        return false;
    return true;
}
/** Placeholders an auto-response body may use, beyond the shared contact ones. */
/**
 * Fills the placeholders in an auto-response body.
 *
 * Supports a fallback after a pipe — `{{product|our services}}` — because a placeholder
 * that resolves to nothing wrecks the sentence around it. A lead that matched no product
 * was being greeted with "thanks for your interest in the ." Anything still unresolved
 * is dropped along with one adjoining space, so the worst case is a slightly terse
 * sentence rather than a visibly broken one.
 */
export function renderBody(body, ctx) {
    const values = {
        name: ctx.contactName?.trim() ?? '',
        phone: ctx.contactPhone?.trim() ?? '',
        email: ctx.contactEmail?.trim() ?? '',
        product: ctx.productName?.trim() ?? '',
        agent: ctx.agentName?.trim() ?? '',
    };
    // One pass over every {{ key }} or {{ key|fallback }}, rather than one pass per key,
    // so a fallback containing another key's name cannot be rewritten in turn.
    let out = body.replace(/\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/gi, (_match, rawKey, rawFallback) => {
        const key = rawKey.trim().toLowerCase();
        const value = values[key];
        if (value)
            return value;
        const fallback = rawFallback?.trim();
        if (fallback)
            return fallback;
        // Unknown key: leave it visible so the operator notices the typo, rather than
        // silently shipping a gap.
        return key in values ? '' : `{{${rawKey}}}`;
    });
    // An emptied placeholder leaves "in the  ." — tidy the seams it left behind.
    out = out
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\s+([.,!?;:])/g, '$1')
        .replace(/[ \t]+$/gm, '');
    return out;
}
async function recordResult(rule, ctx, result) {
    await AutoResponseLogModel.create({
        companyId: new Types.ObjectId(ctx.companyId),
        ruleId: rule._id,
        chatId: new Types.ObjectId(ctx.chatId),
        ...(result.messageId ? { messageId: new Types.ObjectId(result.messageId) } : {}),
        status: result.status,
        ...(result.error ? { error: result.error.slice(0, 500) } : {}),
    });
    await AutoResponseRuleModel.updateOne({ _id: rule._id }, result.status === 'sent'
        ? { $inc: { 'stats.sent': 1 }, $set: { 'stats.lastSentAt': new Date() }, $unset: { 'stats.lastError': '' } }
        : { $inc: { 'stats.failed': 1 }, $set: { 'stats.lastError': result.error?.slice(0, 500) ?? 'failed' } });
}
/**
 * Sends the rule's template. Kept separate from the plain-text path because a template
 * is the only thing WhatsApp delivers outside the 24-hour customer-service window, and
 * it needs its own parameter rendering and message row.
 */
async function sendTemplateAction(rule, ctx, contact) {
    if (!rule.templateId)
        throw new Error('Rule has no template selected');
    const template = await TemplateModel.findOne({
        _id: rule.templateId,
        companyId: new Types.ObjectId(ctx.companyId),
        deletedAt: null,
    }).lean();
    if (!template)
        throw new Error('Template not found');
    if (template.status !== 'APPROVED') {
        throw new Error(`Template "${template.name}" is ${template.status ?? 'not approved'} — Meta will reject it`);
    }
    const variables = (template.variables ?? []);
    const parameters = buildParameterValues(variables, contact);
    const renderedBody = applyTemplate(template.body, contact);
    const msgDoc = await MessageModel.create({
        companyId: new Types.ObjectId(ctx.companyId),
        chatId: new Types.ObjectId(ctx.chatId),
        direction: 'outbound',
        body: renderedBody,
        messageType: 'template',
        status: 'queued',
        isAutomated: true,
        autoResponseRuleId: rule._id,
    });
    try {
        const { sid } = await sendWhatsappTemplateMessage({
            companyId: ctx.companyId,
            whatsappNumberId: ctx.whatsappNumberId,
            toPhone: contact.phone,
            templateName: template.metaTemplateName ?? template.name,
            language: template.language ?? 'en',
            parameters,
            renderedBody,
            ...(template.imageUrl ? { headerImageUrl: template.imageUrl } : {}),
        });
        await MessageModel.updateOne({ _id: msgDoc._id }, { $set: { status: 'sent', twilioSid: sid } });
        try {
            await debitCredits(ctx.companyId, getCreditPerMessage(), 'auto_response', {
                messageId: String(msgDoc._id),
            });
        }
        catch (debitErr) {
            logger.error('Auto-response template sent but wallet debit failed', { err: debitErr });
        }
        await ChatModel.updateOne({ _id: new Types.ObjectId(ctx.chatId) }, { $set: { lastMessageAt: new Date(), lastMessagePreview: renderedBody.slice(0, 140) } });
        const updated = await MessageModel.findById(msgDoc._id).lean();
        emitToCompany(ctx.companyId, 'message:new', { chatId: ctx.chatId, message: updated });
        return String(msgDoc._id);
    }
    catch (e) {
        await MessageModel.updateOne({ _id: msgDoc._id }, { $set: { status: 'failed', statusDetail: e instanceof Error ? e.message : 'send failed' } });
        throw e;
    }
}
/**
 * Evaluates every enabled rule against one inbound message and fires the first match.
 *
 * First match only: a lead that types "price" on a solar ad should get one answer, not
 * the product greeting plus the keyword reply plus the catch-all welcome. Ordering is
 * the rule's `priority`, so the operator decides which one that is.
 *
 * Always call this detached from the webhook — Meta retires a webhook that does not
 * answer within seconds, and a send can take a while.
 */
export async function runAutoResponses(ctx) {
    const rules = (await AutoResponseRuleModel.find({
        companyId: new Types.ObjectId(ctx.companyId),
        deletedAt: null,
        enabled: true,
    })
        .sort({ priority: 1, createdAt: 1 })
        .lean());
    if (!rules.length)
        return;
    const candidates = rules.filter((r) => triggerMatches(r, ctx) && conditionsMatch(r, ctx));
    if (!candidates.length)
        return;
    const chat = await ChatModel.findById(new Types.ObjectId(ctx.chatId)).lean();
    if (!chat)
        return;
    const contact = await ContactModel.findById(chat.contactId).lean();
    if (!contact)
        return;
    const [product, agent] = await Promise.all([
        chat.productId ? ProductModel.findById(chat.productId).select('name').lean() : null,
        chat.assignedTo ? UserModel.findById(chat.assignedTo).select('name').lean() : null,
    ]);
    for (const rule of candidates) {
        if (!(await throttleAllows(rule, ctx)))
            continue;
        try {
            if ((rule.delaySeconds ?? 0) > 0) {
                // Capped: the caller is a detached task, not a queue worker, and a long sleep
                // would survive past a deploy for no benefit.
                const ms = Math.min(rule.delaySeconds ?? 0, 60) * 1000;
                await new Promise((resolve) => setTimeout(resolve, ms));
            }
            let messageId;
            if ((rule.actionType ?? 'text') === 'template') {
                messageId = await sendTemplateAction(rule, ctx, {
                    _id: contact._id,
                    name: contact.name,
                    phone: contact.phone,
                    email: contact.email,
                });
            }
            else {
                const body = renderBody(rule.body ?? '', {
                    contactName: contact.name,
                    contactPhone: contact.phone,
                    contactEmail: contact.email,
                    productName: product?.name ?? null,
                    agentName: agent?.name ?? null,
                });
                if (!body.trim() && !rule.mediaId)
                    throw new Error('Rule has an empty message');
                const sent = await sendOutboundChatMessage({
                    companyId: ctx.companyId,
                    userId: null,
                    chatId: ctx.chatId,
                    body,
                    ...(rule.mediaId ? { mediaId: String(rule.mediaId) } : {}),
                    automation: { ruleId: String(rule._id) },
                });
                messageId = String(sent._id);
            }
            await recordResult(rule, ctx, { status: 'sent', messageId });
            logger.info('Auto-response sent', {
                companyId: ctx.companyId,
                chatId: ctx.chatId,
                rule: rule.name,
            });
            return;
        }
        catch (e) {
            const error = e instanceof Error ? e.message : 'auto-response failed';
            logger.error('Auto-response failed', { companyId: ctx.companyId, rule: rule.name, err: e });
            await recordResult(rule, ctx, { status: 'failed', error });
            // Fall through to the next rule: a broken template should not cost the lead its
            // welcome message.
        }
    }
}
/**
 * Builds the context for a chat and runs the rules. Used by the webhook, which has the
 * chat id but not the derived signals.
 */
export async function runAutoResponsesForInbound(input) {
    const chat = await ChatModel.findById(new Types.ObjectId(input.chatId)).lean();
    if (!chat)
        return;
    await runAutoResponses({
        companyId: input.companyId,
        chatId: input.chatId,
        messageBody: input.messageBody,
        isFirstInbound: input.isFirstInbound,
        whatsappNumberId: String(chat.whatsappNumberId),
        productId: chat.productId ? String(chat.productId) : null,
        adSourceId: chat.referral?.sourceId ?? null,
        adHeadline: chat.referral?.headline ?? null,
        isAdLead: Boolean(chat.referral?.ctwaClid),
    });
}
/* ------------------------------------------------------------------- CRUD */
export async function listAutoResponses(companyId) {
    return AutoResponseRuleModel.find({
        companyId: new Types.ObjectId(companyId),
        deletedAt: null,
    })
        .sort({ priority: 1, createdAt: 1 })
        .lean();
}
/**
 * Fields an explicit `null` clears. MongoDB refuses a `$set` and a `$unset` on the same
 * path in one update — it was that overlap, on `businessHours`, that turned every "save
 * rule" with business hours switched off into a 500.
 */
const CLEARABLE_FIELDS = ['productId', 'templateId', 'mediaId', 'businessHours'];
/** Clearable fields whose value is an id and has to be cast. */
const OID_FIELDS = new Set(['productId', 'templateId', 'mediaId']);
const ARRAY_OID_FIELDS = ['whatsappNumberIds'];
/** Always written as-is. Deliberately excludes everything in CLEARABLE_FIELDS. */
const PLAIN_FIELDS = [
    'name',
    'enabled',
    'priority',
    'trigger',
    'adIds',
    'campaignNames',
    'keywords',
    'adLeadsOnly',
    'actionType',
    'body',
    'delaySeconds',
    'delayMinutes',
    'throttle',
];
function buildRulePatch(input) {
    const set = {};
    const unset = {};
    for (const key of PLAIN_FIELDS) {
        if (input[key] !== undefined)
            set[key] = input[key];
    }
    // One decision per field: an explicit null (or empty string) clears it, any other
    // value writes it, and an absent key leaves whatever is stored alone.
    for (const key of CLEARABLE_FIELDS) {
        const val = input[key];
        if (val === undefined)
            continue;
        if (val === null || val === '') {
            unset[key] = '';
        }
        else {
            set[key] = OID_FIELDS.has(key) ? new Types.ObjectId(String(val)) : val;
        }
    }
    for (const key of ARRAY_OID_FIELDS) {
        if (input[key] === undefined)
            continue;
        set[key] = input[key].map((id) => new Types.ObjectId(id));
    }
    // A field in both halves is a coding mistake, and Mongo reports it as an opaque write
    // error. Fail loudly here instead, where the field name is still in hand.
    const clashing = Object.keys(set).filter((key) => key in unset);
    if (clashing.length) {
        throw new Error(`Cannot set and clear the same field: ${clashing.join(', ')}`);
    }
    return { set, unset };
}
export async function createAutoResponse(companyId, input) {
    const { set } = buildRulePatch(input);
    return AutoResponseRuleModel.create({
        ...set,
        companyId: new Types.ObjectId(companyId),
        deletedAt: null,
    });
}
export async function updateAutoResponse(companyId, ruleId, input) {
    const { set, unset } = buildRulePatch(input);
    return AutoResponseRuleModel.findOneAndUpdate({
        _id: new Types.ObjectId(ruleId),
        companyId: new Types.ObjectId(companyId),
        deletedAt: null,
    }, {
        ...(Object.keys(set).length ? { $set: set } : {}),
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
    }, { new: true }).lean();
}
export async function deleteAutoResponse(companyId, ruleId) {
    const res = await AutoResponseRuleModel.updateOne({
        _id: new Types.ObjectId(ruleId),
        companyId: new Types.ObjectId(companyId),
        deletedAt: null,
    }, { $set: { deletedAt: new Date(), enabled: false } });
    return res.modifiedCount > 0;
}
/**
 * Dry run against a hypothetical lead, so an operator can see which rule would answer
 * before pointing a live ad at it.
 */
export async function previewAutoResponse(companyId, input) {
    const rules = (await AutoResponseRuleModel.find({
        companyId: new Types.ObjectId(companyId),
        deletedAt: null,
        enabled: true,
    })
        .sort({ priority: 1, createdAt: 1 })
        .lean());
    const whatsappNumberId = input.whatsappNumberId ??
        String((await WhatsappNumberModel.findOne({
            companyId: new Types.ObjectId(companyId),
            deletedAt: null,
        })
            .sort({ isDefault: -1 })
            .select('_id')
            .lean())?._id ?? '');
    const ctx = {
        companyId,
        chatId: new Types.ObjectId().toString(),
        messageBody: input.messageBody,
        isFirstInbound: input.isFirstInbound ?? true,
        whatsappNumberId,
        productId: input.productId ?? null,
        adSourceId: input.adSourceId ?? null,
        adHeadline: input.adHeadline ?? null,
        isAdLead: input.isAdLead ?? Boolean(input.adSourceId),
    };
    const match = rules.find((r) => triggerMatches(r, ctx) && conditionsMatch(r, ctx));
    if (!match)
        return null;
    return {
        ruleId: String(match._id),
        name: match.name,
        actionType: match.actionType ?? 'text',
        ...(match.body ? { body: match.body } : {}),
    };
}
