import { Types } from 'mongoose';
import { ChatModel, openLeadStatusFilter } from './chat.model.js';
import { ChatNoteModel } from './chat-note.model.js';
import { ContactModel } from '../contact/contact.model.js';
import { ContactGroupModel } from '../contact/contact-group.model.js';
import { ActivityLogModel } from '../activity/activity-log.model.js';
import { logActivity } from '../activity/activity.service.js';
import { MessageModel } from './message.model.js';
import { MediaModel } from '../media/media.model.js';
import { WhatsappNumberModel } from '../twilio/whatsapp-number.model.js';
import { UserModel } from '../user/user.model.js';
import { ProductModel } from '../product/product.model.js';
import { emitToCompany } from '../../socket/io.js';
import { debitCredits, getCreditPerMessage } from '../wallet/wallet.service.js';
import { sendWhatsappMessage, sendWhatsappTemplateMessage } from '../messaging/messaging.service.js';
import { TemplateModel } from '../template/template.model.js';
import { buildParameterValues } from '../template/template.service.js';
import { applyTemplate } from '../../utils/templateRender.js';
import { recordQuickReplyUse } from './quick-reply.service.js';
import { presignGet } from '../media/s3.service.js';
import { deliverableKind, assertWithinSizeLimit } from '../media/media-kind.js';
import { isS3MediaConfigured } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
export class ChatAccessError extends Error {
    status;
    constructor(message, status = 403) {
        super(message);
        this.status = status;
    }
}
/**
 * Turns a stored attachment into something the browser can render.
 *
 * The presigned GET is minted per response rather than stored, so the bucket stays
 * private and an old API payload cannot be replayed a week later to pull a customer's
 * documents.
 */
async function resolveMediaUrl(media) {
    if (!media)
        return null;
    if (media.key && isS3MediaConfigured()) {
        try {
            return await presignGet(media.key);
        }
        catch (e) {
            logger.warn('Could not presign media for read', { key: media.key, err: e });
        }
    }
    return media.url ?? null;
}
async function serializeMessages(rows) {
    return Promise.all(rows.map(async (row) => {
        if (!row.media)
            return row;
        return { ...row, media: { ...row.media, url: await resolveMediaUrl(row.media) } };
    }));
}
/* ------------------------------------------------------------ access rules */
/**
 * Whether this caller may touch this conversation.
 *
 * Agents see only the leads assigned to them — an unassigned lead or a colleague's is
 * off limits, the same way a CRM scopes a rep to their own pipeline. Company admins and
 * super admins see everything so they can reassign and audit.
 */
export async function assertChatAccess(input) {
    const chat = await ChatModel.findOne({
        _id: new Types.ObjectId(input.chatId),
        companyId: new Types.ObjectId(input.companyId),
        deletedAt: null,
    });
    if (!chat)
        throw new ChatAccessError('Chat not found', 404);
    if (input.role !== 'company_admin') {
        const owner = chat.assignedTo ? String(chat.assignedTo) : null;
        if (owner !== input.userId) {
            throw new ChatAccessError('This lead is assigned to someone else', 403);
        }
    }
    return { chat };
}
/**
 * Inbox / lead list. Agents are silently narrowed to their own leads regardless of the
 * filter they ask for, so a hand-written query string cannot widen their view.
 */
export async function listChats(companyId, viewer, filter = {}) {
    const companyOid = new Types.ObjectId(companyId);
    const query = { companyId: companyOid, deletedAt: null };
    const assigned = viewer.role === 'company_admin' ? (filter.assigned ?? 'all') : 'mine';
    if (assigned === 'mine') {
        query.assignedTo = new Types.ObjectId(viewer.userId);
    }
    else if (assigned === 'unassigned') {
        query.$or = [{ assignedTo: null }, { assignedTo: { $exists: false } }];
    }
    else if (assigned !== 'all' && Types.ObjectId.isValid(assigned)) {
        query.assignedTo = new Types.ObjectId(assigned);
    }
    if (filter.status === 'open') {
        query.status = openLeadStatusFilter();
    }
    else if (filter.status === 'new') {
        // A chat created before the pipeline existed has no status; it is a new lead.
        query.status = { $in: ['new', null] };
    }
    else if (filter.status) {
        query.status = filter.status;
    }
    if (filter.productId && Types.ObjectId.isValid(filter.productId)) {
        query.productId = new Types.ObjectId(filter.productId);
    }
    if (filter.adOnly) {
        query['referral.ctwaClid'] = { $type: 'string' };
    }
    const rows = (await ChatModel.find(query)
        .sort({ lastMessageAt: -1, createdAt: -1 })
        .limit(500)
        .populate('contactId', 'name phone email tags')
        .lean());
    const decorated = await decorateChats(rows);
    const search = filter.search?.trim().toLowerCase();
    if (!search)
        return decorated;
    return decorated.filter((c) => {
        const contact = c.contactId;
        const hay = `${contact?.name ?? ''} ${contact?.phone ?? ''} ${String(c.lastMessagePreview ?? '')}`;
        return hay.toLowerCase().includes(search);
    });
}
/** Adds the assignee and product names the list UI needs, in two batched lookups. */
async function decorateChats(rows) {
    const userIds = [...new Set(rows.map((r) => r.assignedTo).filter(Boolean).map(String))];
    const productIds = [...new Set(rows.map((r) => r.productId).filter(Boolean).map(String))];
    const [users, products] = await Promise.all([
        userIds.length
            ? UserModel.find({ _id: { $in: userIds.map((id) => new Types.ObjectId(id)) } })
                .select('name email')
                .lean()
            : Promise.resolve([]),
        productIds.length
            ? ProductModel.find({ _id: { $in: productIds.map((id) => new Types.ObjectId(id)) } })
                .select('name')
                .lean()
            : Promise.resolve([]),
    ]);
    const userMap = new Map(users.map((u) => [String(u._id), { name: u.name, email: u.email }]));
    const productMap = new Map(products.map((p) => [String(p._id), p.name]));
    return rows.map((r) => ({
        ...r,
        assignedToUser: r.assignedTo ? (userMap.get(String(r.assignedTo)) ?? null) : null,
        productName: r.productId ? (productMap.get(String(r.productId)) ?? null) : null,
    }));
}
export async function listMessages(companyId, chatId, opts) {
    const limit = Math.min(100, Math.max(1, opts?.limit ?? 50));
    const filter = {
        companyId: new Types.ObjectId(companyId),
        chatId: new Types.ObjectId(chatId),
        deletedAt: null,
    };
    if (opts?.before && Types.ObjectId.isValid(opts.before)) {
        filter._id = { $lt: new Types.ObjectId(opts.before) };
    }
    const rows = await MessageModel.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    return serializeMessages(rows.reverse());
}
/** Resolves the caller's `mediaId` into everything the send path and the log both need. */
async function loadOutboundMedia(companyId, mediaId) {
    const doc = await MediaModel.findOne({
        _id: new Types.ObjectId(mediaId),
        companyId: new Types.ObjectId(companyId),
        deletedAt: null,
    }).lean();
    if (!doc)
        throw new Error('Attachment not found');
    const kind = deliverableKind(doc.mimeType);
    if (doc.size)
        assertWithinSizeLimit(kind, doc.size);
    // WhatsApp fetches the link itself, so it has to be reachable without our auth —
    // a presigned GET is exactly that, and it expires long before it could be shared.
    const link = isS3MediaConfigured() ? await presignGet(doc.key, 900) : doc.url;
    if (!link)
        throw new Error('Attachment has no reachable URL — check media storage settings');
    return {
        media: {
            mediaId: doc._id,
            key: doc.key,
            url: doc.url,
            mimeType: doc.mimeType,
            ...(doc.filename ? { filename: doc.filename } : {}),
            ...(doc.size ? { size: doc.size } : {}),
            kind,
        },
        link,
    };
}
/**
 * Sends a message from the workspace to the contact.
 *
 * `userId` is null for automations: the message is still logged and billed, but it is
 * flagged so the inbox can label it and so a bot reply never counts as an agent touch.
 */
/**
 * How long the contact's 24-hour service window has left.
 *
 * WhatsApp only delivers a free-form message within 24 hours of the contact's last
 * one; after that the workspace must use an approved template. The composer shows this
 * so an agent is not left guessing why a reply bounced.
 */
export function serviceWindow(input) {
    if (!input.lastInboundAt) {
        // Two different unknowns. A contact who has never written cannot be reached with
        // free text at all, which we do know. A conversation that predates this field has
        // a window we cannot compute — blocking the composer on that guess would freeze
        // every existing chat until the contact happened to write again.
        return {
            open: false,
            known: !input.everInbound,
            expiresAt: null,
            minutesLeft: 0,
        };
    }
    const expires = new Date(input.lastInboundAt.getTime() + 24 * 60 * 60 * 1000);
    const minutesLeft = Math.floor((expires.getTime() - Date.now()) / 60000);
    return {
        open: minutesLeft > 0,
        known: true,
        expiresAt: expires.toISOString(),
        minutesLeft: Math.max(0, minutesLeft),
    };
}
export async function sendOutboundChatMessage(input) {
    const chat = await ChatModel.findOne({
        _id: new Types.ObjectId(input.chatId),
        companyId: new Types.ObjectId(input.companyId),
        deletedAt: null,
    }).lean();
    if (!chat)
        throw new Error('Chat not found');
    const body = input.body ?? '';
    if (!body.trim() && !input.mediaId)
        throw new Error('Nothing to send');
    const contact = await ContactModel.findById(chat.contactId).lean();
    if (!contact)
        throw new Error('Contact not found');
    const wa = await WhatsappNumberModel.findOne({
        _id: chat.whatsappNumberId,
        companyId: new Types.ObjectId(input.companyId),
        deletedAt: null,
    }).lean();
    if (!wa)
        throw new Error('WhatsApp number not configured');
    let media;
    let link;
    if (input.mediaId) {
        const resolved = await loadOutboundMedia(input.companyId, input.mediaId);
        media = resolved.media;
        link = resolved.link;
    }
    const msgDoc = await MessageModel.create({
        companyId: new Types.ObjectId(input.companyId),
        chatId: new Types.ObjectId(input.chatId),
        direction: 'outbound',
        body,
        messageType: media?.kind ?? 'text',
        status: 'queued',
        ...(media ? { media, mediaId: media.mediaId } : {}),
        ...(input.userId ? { senderUserId: new Types.ObjectId(input.userId) } : {}),
        ...(input.automation
            ? { isAutomated: true, autoResponseRuleId: new Types.ObjectId(input.automation.ruleId) }
            : {}),
    });
    try {
        const { sid } = await sendWhatsappMessage({
            companyId: input.companyId,
            whatsappNumberId: String(wa._id),
            toPhone: contact.phone,
            body,
            ...(link ? { mediaUrl: [link] } : {}),
            ...(media?.kind ? { mediaKind: media.kind } : {}),
            ...(media?.filename ? { filename: media.filename } : {}),
        });
        await MessageModel.updateOne({ _id: msgDoc._id }, { $set: { status: 'sent', twilioSid: sid }, $unset: { statusDetail: '' } });
        try {
            await debitCredits(input.companyId, getCreditPerMessage(), 'chat_message', {
                messageId: String(msgDoc._id),
            });
        }
        catch (debitErr) {
            logger.error('Chat message sent but wallet debit failed', {
                err: debitErr,
                messageId: String(msgDoc._id),
            });
        }
        const preview = body.trim() || `[${media?.kind ?? 'attachment'}]`;
        const chatUpdate = {
            lastMessageAt: new Date(),
            lastMessagePreview: preview.slice(0, 140),
        };
        // A bot reply must not look like an agent touch, or the follow-up nudges would
        // never fire on a lead nobody has actually answered.
        if (input.userId && !input.automation) {
            chatUpdate.lastAgentReplyAt = new Date();
            if (chat.status === 'new')
                chatUpdate.status = 'in_progress';
        }
        await ChatModel.updateOne({ _id: chat._id }, { $set: chatUpdate });
        if (input.quickReplyId) {
            // Best effort: a counter that failed to increment must not fail a delivered message.
            await recordQuickReplyUse(input.companyId, input.quickReplyId).catch((err) => logger.warn('Quick reply use counter failed', { err }));
        }
        const updated = await MessageModel.findById(msgDoc._id).lean();
        const [serialized] = await serializeMessages([updated]);
        emitToCompany(input.companyId, 'message:new', { chatId: input.chatId, message: serialized });
        return serialized;
    }
    catch (e) {
        logger.error('Outbound chat send failed', { err: e });
        await MessageModel.updateOne({ _id: msgDoc._id, twilioSid: { $exists: false } }, {
            $set: {
                status: 'failed',
                statusDetail: e instanceof Error ? e.message : 'send failed',
            },
        });
        throw e;
    }
}
/**
 * Sends an approved template into an existing conversation.
 *
 * This is the only thing WhatsApp delivers once the 24-hour service window has closed,
 * so it is what the composer falls back to. A template that Meta has not approved is
 * refused here with its own status rather than being sent and silently failing.
 */
export async function sendChatTemplateMessage(input) {
    const companyOid = new Types.ObjectId(input.companyId);
    const chat = await ChatModel.findOne({
        _id: new Types.ObjectId(input.chatId),
        companyId: companyOid,
        deletedAt: null,
    }).lean();
    if (!chat)
        throw new Error('Chat not found');
    const [contact, template] = await Promise.all([
        ContactModel.findById(chat.contactId).lean(),
        TemplateModel.findOne({
            _id: new Types.ObjectId(input.templateId),
            companyId: companyOid,
            deletedAt: null,
        }).lean(),
    ]);
    if (!contact)
        throw new Error('Contact not found');
    if (!template)
        throw new Error('Template not found');
    if (template.status !== 'APPROVED') {
        throw new Error(`“${template.name}” is ${template.status ?? 'not approved'} — only approved templates can be sent`);
    }
    const variables = (template.variables ?? []);
    const renderedBody = applyTemplate(template.body, contact);
    const msgDoc = await MessageModel.create({
        companyId: companyOid,
        chatId: new Types.ObjectId(input.chatId),
        direction: 'outbound',
        body: renderedBody,
        messageType: 'template',
        status: 'queued',
        senderUserId: new Types.ObjectId(input.userId),
    });
    try {
        const { sid } = await sendWhatsappTemplateMessage({
            companyId: input.companyId,
            whatsappNumberId: String(chat.whatsappNumberId),
            toPhone: contact.phone,
            templateName: template.metaTemplateName ?? template.name,
            language: template.language ?? 'en',
            parameters: buildParameterValues(variables, contact),
            renderedBody,
            ...(template.imageUrl ? { headerImageUrl: template.imageUrl } : {}),
        });
        await MessageModel.updateOne({ _id: msgDoc._id }, { $set: { status: 'sent', twilioSid: sid }, $unset: { statusDetail: '' } });
        try {
            await debitCredits(input.companyId, getCreditPerMessage(), 'chat_template', {
                messageId: String(msgDoc._id),
            });
        }
        catch (debitErr) {
            logger.error('Chat template sent but wallet debit failed', { err: debitErr });
        }
        await ChatModel.updateOne({ _id: chat._id }, {
            $set: {
                lastMessageAt: new Date(),
                lastMessagePreview: renderedBody.slice(0, 140),
                lastAgentReplyAt: new Date(),
                ...(chat.status === 'new' ? { status: 'in_progress' } : {}),
            },
        });
        const updated = await MessageModel.findById(msgDoc._id).lean();
        const [serialized] = await serializeMessages([updated]);
        emitToCompany(input.companyId, 'message:new', { chatId: input.chatId, message: serialized });
        return serialized;
    }
    catch (e) {
        await MessageModel.updateOne({ _id: msgDoc._id, twilioSid: { $exists: false } }, {
            $set: {
                status: 'failed',
                statusDetail: e instanceof Error ? e.message : 'template send failed',
            },
        });
        throw e;
    }
}
/**
 * Everything the details rail shows for one conversation: the decorated chat, how much
 * of the service window is left, the contact's groups, and the trail of what happened
 * to this lead. One call rather than five, because the rail opens as a unit.
 */
export async function getChatDetail(companyId, chatId) {
    const companyOid = new Types.ObjectId(companyId);
    const chatOid = new Types.ObjectId(chatId);
    const chat = (await ChatModel.findOne({ _id: chatOid, companyId: companyOid, deletedAt: null })
        .populate('contactId', 'name phone email tags')
        .lean());
    if (!chat)
        throw new ChatAccessError('Chat not found', 404);
    const contactOid = chat.contactId?._id;
    const [groups, activity] = await Promise.all([
        contactOid
            ? ContactGroupModel.find({ companyId: companyOid, contactIds: contactOid, deletedAt: null })
                .select('name')
                .lean()
            : Promise.resolve([]),
        ActivityLogModel.find({ companyId: companyOid, resource: 'chat', resourceId: chatOid })
            .sort({ createdAt: -1 })
            .limit(12)
            .populate('userId', 'name email')
            .lean(),
    ]);
    const [decorated] = await decorateChats([chat]);
    return {
        chat: decorated,
        serviceWindow: serviceWindow({
            lastInboundAt: chat.lastInboundAt ?? null,
            everInbound: Boolean(chat.firstInboundAt),
        }),
        groups: groups.map((g) => ({ _id: String(g._id), name: g.name })),
        activity,
    };
}
/** Replaces the contact's tag list — the "+ Add" chip in the details rail. */
export async function setContactTags(input) {
    const chat = await ChatModel.findOne({
        _id: new Types.ObjectId(input.chatId),
        companyId: new Types.ObjectId(input.companyId),
        deletedAt: null,
    })
        .select('contactId')
        .lean();
    if (!chat)
        throw new ChatAccessError('Chat not found', 404);
    // Trimmed, de-duplicated and case-insensitively unique, so "Delhi" and "delhi" do not
    // both end up on the contact.
    const seen = new Set();
    const tags = [];
    for (const raw of input.tags) {
        const tag = raw.trim();
        const key = tag.toLowerCase();
        if (!tag || seen.has(key))
            continue;
        seen.add(key);
        tags.push(tag);
    }
    await ContactModel.updateOne({ _id: chat.contactId }, { $set: { tags } });
    return tags;
}
/* ---------------------------------------------------------------- lead ops */
export async function updateLeadStatus(input) {
    const res = await ChatModel.findOneAndUpdate({
        _id: new Types.ObjectId(input.chatId),
        companyId: new Types.ObjectId(input.companyId),
        deletedAt: null,
    }, { $set: { status: input.status } }, { new: true }).lean();
    if (!res)
        throw new ChatAccessError('Chat not found', 404);
    emitToCompany(input.companyId, 'lead:status', { chatId: input.chatId, status: input.status });
    // Feeds the "recent activity" trail in the details rail.
    await logActivity({
        companyId: input.companyId,
        userId: input.actorUserId,
        action: 'lead.status_changed',
        resource: 'chat',
        resourceId: input.chatId,
        meta: { status: input.status },
    });
    return res;
}
/**
 * Clear a conversation's unread badge.
 *
 * The counter was only ever incremented by the inbound webhooks and had nothing to
 * reset it, so every chat ever opened stayed unread and the workspace total climbed
 * past the number of conversations.
 */
export async function markChatRead(companyId, chatId) {
    const res = await ChatModel.updateOne({
        _id: new Types.ObjectId(chatId),
        companyId: new Types.ObjectId(companyId),
        deletedAt: null,
        unreadCount: { $gt: 0 },
    }, { $set: { unreadCount: 0 } });
    // Only announce a real change, so opening an already-read chat does not churn
    // every other agent's inbox.
    if (res.modifiedCount > 0) {
        emitToCompany(companyId, 'chat:read', { chatId, unreadCount: 0 });
    }
}
export async function listChatNotes(companyId, chatId) {
    return ChatNoteModel.find({
        companyId: new Types.ObjectId(companyId),
        chatId: new Types.ObjectId(chatId),
        deletedAt: null,
    })
        .sort({ createdAt: -1 })
        .populate('userId', 'name email')
        .lean();
}
export async function addChatNote(input) {
    const note = await ChatNoteModel.create({
        companyId: new Types.ObjectId(input.companyId),
        chatId: new Types.ObjectId(input.chatId),
        userId: new Types.ObjectId(input.userId),
        body: input.body.trim(),
    });
    const populated = await ChatNoteModel.findById(note._id).populate('userId', 'name email').lean();
    emitToCompany(input.companyId, 'lead:note', { chatId: input.chatId, note: populated });
    return populated;
}
export async function deleteChatNote(input) {
    const filter = {
        _id: new Types.ObjectId(input.noteId),
        companyId: new Types.ObjectId(input.companyId),
        chatId: new Types.ObjectId(input.chatId),
        deletedAt: null,
    };
    // An agent may retract their own note; only an admin can remove someone else's.
    if (input.role !== 'company_admin')
        filter.userId = new Types.ObjectId(input.userId);
    const res = await ChatNoteModel.updateOne(filter, { $set: { deletedAt: new Date() } });
    if (!res.modifiedCount)
        throw new ChatAccessError('Note not found', 404);
}
/* ------------------------------------------------------------ chat opening */
export async function openChatWithContact(input) {
    const companyOid = new Types.ObjectId(input.companyId);
    const contact = await ContactModel.findOne({
        _id: new Types.ObjectId(input.contactId),
        companyId: companyOid,
        deletedAt: null,
    }).lean();
    if (!contact)
        throw new Error('Contact not found');
    let waId;
    if (input.whatsappNumberId) {
        const wa = await WhatsappNumberModel.findOne({
            _id: new Types.ObjectId(input.whatsappNumberId),
            companyId: companyOid,
            deletedAt: null,
        }).lean();
        if (!wa)
            throw new Error('WhatsApp sender not found');
        waId = wa._id;
    }
    else {
        const wa = await WhatsappNumberModel.findOne({
            companyId: companyOid,
            deletedAt: null,
        })
            .sort({ isDefault: -1, updatedAt: -1 })
            .lean();
        if (!wa)
            throw new Error('No WhatsApp sender configured — add one in Settings');
        waId = wa._id;
    }
    let chat = await ChatModel.findOne({
        companyId: companyOid,
        contactId: contact._id,
        whatsappNumberId: waId,
        deletedAt: null,
    });
    if (!chat) {
        chat = await ChatModel.create({
            companyId: companyOid,
            contactId: contact._id,
            whatsappNumberId: waId,
            // Outbound-first conversations belong to whoever reached out; the round-robin
            // is for leads that arrive on their own.
            ...(input.userId
                ? {
                    assignedTo: new Types.ObjectId(input.userId),
                    assignedAt: new Date(),
                    assignmentMethod: 'self',
                }
                : {}),
        });
    }
    const populated = (await ChatModel.findById(chat._id)
        .populate('contactId', 'name phone email tags')
        .lean());
    if (!populated)
        throw new Error('Chat not found');
    const [decorated] = await decorateChats([populated]);
    return decorated;
}
export async function ensureInboundChat(input) {
    let contact = await ContactModel.findOne({
        companyId: new Types.ObjectId(input.companyId),
        phone: input.contactPhone,
        deletedAt: null,
    });
    if (!contact) {
        contact = await ContactModel.create({
            companyId: new Types.ObjectId(input.companyId),
            phone: input.contactPhone,
            name: input.contactName,
        });
    }
    let chat = await ChatModel.findOne({
        companyId: new Types.ObjectId(input.companyId),
        contactId: contact._id,
        whatsappNumberId: input.whatsappNumberId,
        deletedAt: null,
    });
    if (!chat) {
        chat = await ChatModel.create({
            companyId: new Types.ObjectId(input.companyId),
            contactId: contact._id,
            whatsappNumberId: input.whatsappNumberId,
        });
    }
    return { chatId: String(chat._id), contactId: String(contact._id) };
}
/** Lead counts for the dashboard/leads header, scoped the same way the list is. */
export async function leadStatusCounts(companyId, viewer) {
    const match = {
        companyId: new Types.ObjectId(companyId),
        deletedAt: null,
    };
    if (viewer.role !== 'company_admin')
        match.assignedTo = new Types.ObjectId(viewer.userId);
    const rows = await ChatModel.aggregate([
        { $match: match },
        { $group: { _id: '$status', n: { $sum: 1 } } },
    ]);
    const counts = { new: 0, in_progress: 0, qualified: 0, won: 0, lost: 0 };
    let total = 0;
    for (const r of rows) {
        // A null group is a pre-pipeline chat, which counts as new.
        const key = r._id ?? 'new';
        if (key in counts)
            counts[key] = (counts[key] ?? 0) + r.n;
        total += r.n;
    }
    const unassigned = viewer.role === 'company_admin'
        ? await ChatModel.countDocuments({
            companyId: new Types.ObjectId(companyId),
            deletedAt: null,
            status: openLeadStatusFilter(),
            $or: [{ assignedTo: null }, { assignedTo: { $exists: false } }],
        })
        : 0;
    return { ...counts, total, unassigned };
}
