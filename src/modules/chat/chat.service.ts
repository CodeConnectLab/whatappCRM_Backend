import { Types } from 'mongoose';
import { ChatModel, openLeadStatusFilter, type LeadStatus } from './chat.model.js';
import { ChatNoteModel } from './chat-note.model.js';
import { ContactModel } from '../contact/contact.model.js';
import { MessageModel } from './message.model.js';
import { MediaModel } from '../media/media.model.js';
import { WhatsappNumberModel } from '../twilio/whatsapp-number.model.js';
import { UserModel } from '../user/user.model.js';
import { ProductModel } from '../product/product.model.js';
import { emitToCompany } from '../../socket/io.js';
import { debitCredits, getCreditPerMessage } from '../wallet/wallet.service.js';
import { sendWhatsappMessage } from '../messaging/messaging.service.js';
import { presignGet } from '../media/s3.service.js';
import { deliverableKind, assertWithinSizeLimit, type MediaKind } from '../media/media-kind.js';
import { isS3MediaConfigured } from '../../config/env.js';
import { logger } from '../../utils/logger.js';

export class ChatAccessError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.status = status;
  }
}

/* ------------------------------------------------------------- serializing */

type StoredMedia = {
  mediaId?: Types.ObjectId | null;
  key?: string | null;
  url?: string | null;
  mimeType?: string | null;
  filename?: string | null;
  size?: number | null;
  kind?: string | null;
};

/**
 * Turns a stored attachment into something the browser can render.
 *
 * The presigned GET is minted per response rather than stored, so the bucket stays
 * private and an old API payload cannot be replayed a week later to pull a customer's
 * documents.
 */
async function resolveMediaUrl(media: StoredMedia | null | undefined): Promise<string | null> {
  if (!media) return null;
  if (media.key && isS3MediaConfigured()) {
    try {
      return await presignGet(media.key);
    } catch (e) {
      logger.warn('Could not presign media for read', { key: media.key, err: e });
    }
  }
  return media.url ?? null;
}

type StoredMessage = {
  _id: Types.ObjectId;
  media?: StoredMedia | null;
  [key: string]: unknown;
};

async function serializeMessages<T extends StoredMessage>(rows: T[]) {
  return Promise.all(
    rows.map(async (row) => {
      if (!row.media) return row;
      return { ...row, media: { ...row.media, url: await resolveMediaUrl(row.media) } };
    }),
  );
}

/* ------------------------------------------------------------ access rules */

/**
 * Whether this caller may touch this conversation.
 *
 * Agents see only the leads assigned to them — an unassigned lead or a colleague's is
 * off limits, the same way a CRM scopes a rep to their own pipeline. Company admins and
 * super admins see everything so they can reassign and audit.
 */
export async function assertChatAccess(input: {
  companyId: string;
  chatId: string;
  userId: string;
  role: 'company_admin' | 'agent';
}): Promise<{ chat: NonNullable<Awaited<ReturnType<typeof ChatModel.findOne>>> }> {
  const chat = await ChatModel.findOne({
    _id: new Types.ObjectId(input.chatId),
    companyId: new Types.ObjectId(input.companyId),
    deletedAt: null,
  });
  if (!chat) throw new ChatAccessError('Chat not found', 404);

  if (input.role !== 'company_admin') {
    const owner = chat.assignedTo ? String(chat.assignedTo) : null;
    if (owner !== input.userId) {
      throw new ChatAccessError('This lead is assigned to someone else', 403);
    }
  }
  return { chat };
}

/* ------------------------------------------------------------------ chats */

export type ListChatsFilter = {
  /** 'mine' | 'unassigned' | 'all' | a specific user id. Agents are pinned to 'mine'. */
  assigned?: string;
  status?: LeadStatus | 'open';
  productId?: string;
  search?: string;
  /** Only leads that came from a paid ad. */
  adOnly?: boolean;
};

type ChatListRow = {
  _id: Types.ObjectId;
  assignedTo?: Types.ObjectId | null;
  productId?: Types.ObjectId | null;
  [key: string]: unknown;
};

/**
 * Inbox / lead list. Agents are silently narrowed to their own leads regardless of the
 * filter they ask for, so a hand-written query string cannot widen their view.
 */
export async function listChats(
  companyId: string,
  viewer: { userId: string; role: 'company_admin' | 'agent' },
  filter: ListChatsFilter = {},
) {
  const companyOid = new Types.ObjectId(companyId);
  const query: Record<string, unknown> = { companyId: companyOid, deletedAt: null };

  const assigned = viewer.role === 'company_admin' ? (filter.assigned ?? 'all') : 'mine';
  if (assigned === 'mine') {
    query.assignedTo = new Types.ObjectId(viewer.userId);
  } else if (assigned === 'unassigned') {
    query.$or = [{ assignedTo: null }, { assignedTo: { $exists: false } }];
  } else if (assigned !== 'all' && Types.ObjectId.isValid(assigned)) {
    query.assignedTo = new Types.ObjectId(assigned);
  }

  if (filter.status === 'open') {
    query.status = openLeadStatusFilter();
  } else if (filter.status === 'new') {
    // A chat created before the pipeline existed has no status; it is a new lead.
    query.status = { $in: ['new', null] };
  } else if (filter.status) {
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
    .lean()) as unknown as ChatListRow[];

  const decorated = await decorateChats(rows);

  const search = filter.search?.trim().toLowerCase();
  if (!search) return decorated;
  return decorated.filter((c) => {
    const contact = c.contactId as { name?: string; phone?: string } | undefined;
    const hay = `${contact?.name ?? ''} ${contact?.phone ?? ''} ${String(c.lastMessagePreview ?? '')}`;
    return hay.toLowerCase().includes(search);
  });
}

/** Adds the assignee and product names the list UI needs, in two batched lookups. */
async function decorateChats<T extends ChatListRow>(rows: T[]) {
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

export async function listMessages(
  companyId: string,
  chatId: string,
  opts?: { limit?: number; before?: string },
) {
  const limit = Math.min(100, Math.max(1, opts?.limit ?? 50));
  const filter: Record<string, unknown> = {
    companyId: new Types.ObjectId(companyId),
    chatId: new Types.ObjectId(chatId),
    deletedAt: null,
  };
  if (opts?.before && Types.ObjectId.isValid(opts.before)) {
    filter._id = { $lt: new Types.ObjectId(opts.before) };
  }
  const rows = await MessageModel.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
  return serializeMessages(rows.reverse() as unknown as StoredMessage[]);
}

/* ------------------------------------------------------------- outbound */

type OutboundMedia = {
  mediaId?: Types.ObjectId;
  key?: string;
  url?: string;
  mimeType?: string;
  filename?: string;
  size?: number;
  kind?: MediaKind;
};

/** Resolves the caller's `mediaId` into everything the send path and the log both need. */
async function loadOutboundMedia(
  companyId: string,
  mediaId: string,
): Promise<{ media: OutboundMedia; link: string }> {
  const doc = await MediaModel.findOne({
    _id: new Types.ObjectId(mediaId),
    companyId: new Types.ObjectId(companyId),
    deletedAt: null,
  }).lean();
  if (!doc) throw new Error('Attachment not found');

  const kind = deliverableKind(doc.mimeType);
  if (doc.size) assertWithinSizeLimit(kind, doc.size);

  // WhatsApp fetches the link itself, so it has to be reachable without our auth —
  // a presigned GET is exactly that, and it expires long before it could be shared.
  const link = isS3MediaConfigured() ? await presignGet(doc.key, 900) : doc.url;
  if (!link) throw new Error('Attachment has no reachable URL — check media storage settings');

  return {
    media: {
      mediaId: doc._id as Types.ObjectId,
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
export async function sendOutboundChatMessage(input: {
  companyId: string;
  userId: string | null;
  chatId: string;
  body: string;
  mediaId?: string;
  automation?: { ruleId: string };
}) {
  const chat = await ChatModel.findOne({
    _id: new Types.ObjectId(input.chatId),
    companyId: new Types.ObjectId(input.companyId),
    deletedAt: null,
  }).lean();
  if (!chat) throw new Error('Chat not found');

  const body = input.body ?? '';
  if (!body.trim() && !input.mediaId) throw new Error('Nothing to send');

  const contact = await ContactModel.findById(chat.contactId).lean();
  if (!contact) throw new Error('Contact not found');
  const wa = await WhatsappNumberModel.findOne({
    _id: chat.whatsappNumberId,
    companyId: new Types.ObjectId(input.companyId),
    deletedAt: null,
  }).lean();
  if (!wa) throw new Error('WhatsApp number not configured');

  let media: OutboundMedia | undefined;
  let link: string | undefined;
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

    await MessageModel.updateOne(
      { _id: msgDoc._id },
      { $set: { status: 'sent', twilioSid: sid }, $unset: { statusDetail: '' } },
    );

    try {
      await debitCredits(input.companyId, getCreditPerMessage(), 'chat_message', {
        messageId: String(msgDoc._id),
      });
    } catch (debitErr) {
      logger.error('Chat message sent but wallet debit failed', {
        err: debitErr,
        messageId: String(msgDoc._id),
      });
    }

    const preview = body.trim() || `[${media?.kind ?? 'attachment'}]`;
    const chatUpdate: Record<string, unknown> = {
      lastMessageAt: new Date(),
      lastMessagePreview: preview.slice(0, 140),
    };
    // A bot reply must not look like an agent touch, or the follow-up nudges would
    // never fire on a lead nobody has actually answered.
    if (input.userId && !input.automation) {
      chatUpdate.lastAgentReplyAt = new Date();
      if (chat.status === 'new') chatUpdate.status = 'in_progress';
    }
    await ChatModel.updateOne({ _id: chat._id }, { $set: chatUpdate });

    const updated = await MessageModel.findById(msgDoc._id).lean();
    const [serialized] = await serializeMessages([updated as unknown as StoredMessage]);
    emitToCompany(input.companyId, 'message:new', { chatId: input.chatId, message: serialized });
    return serialized;
  } catch (e) {
    logger.error('Outbound chat send failed', { err: e });
    await MessageModel.updateOne(
      { _id: msgDoc._id, twilioSid: { $exists: false } },
      {
        $set: {
          status: 'failed',
          statusDetail: e instanceof Error ? e.message : 'send failed',
        },
      },
    );
    throw e;
  }
}

/* ---------------------------------------------------------------- lead ops */

export async function updateLeadStatus(input: {
  companyId: string;
  chatId: string;
  actorUserId: string;
  status: LeadStatus;
}) {
  const res = await ChatModel.findOneAndUpdate(
    {
      _id: new Types.ObjectId(input.chatId),
      companyId: new Types.ObjectId(input.companyId),
      deletedAt: null,
    },
    { $set: { status: input.status } },
    { new: true },
  ).lean();
  if (!res) throw new ChatAccessError('Chat not found', 404);
  emitToCompany(input.companyId, 'lead:status', { chatId: input.chatId, status: input.status });
  return res;
}

export async function markChatRead(companyId: string, chatId: string): Promise<void> {
  await ChatModel.updateOne(
    { _id: new Types.ObjectId(chatId), companyId: new Types.ObjectId(companyId) },
    { $set: { unreadCount: 0 } },
  );
}

export async function listChatNotes(companyId: string, chatId: string) {
  return ChatNoteModel.find({
    companyId: new Types.ObjectId(companyId),
    chatId: new Types.ObjectId(chatId),
    deletedAt: null,
  })
    .sort({ createdAt: -1 })
    .populate('userId', 'name email')
    .lean();
}

export async function addChatNote(input: {
  companyId: string;
  chatId: string;
  userId: string;
  body: string;
}) {
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

export async function deleteChatNote(input: {
  companyId: string;
  chatId: string;
  noteId: string;
  userId: string;
  role: 'company_admin' | 'agent';
}): Promise<void> {
  const filter: Record<string, unknown> = {
    _id: new Types.ObjectId(input.noteId),
    companyId: new Types.ObjectId(input.companyId),
    chatId: new Types.ObjectId(input.chatId),
    deletedAt: null,
  };
  // An agent may retract their own note; only an admin can remove someone else's.
  if (input.role !== 'company_admin') filter.userId = new Types.ObjectId(input.userId);

  const res = await ChatNoteModel.updateOne(filter, { $set: { deletedAt: new Date() } });
  if (!res.modifiedCount) throw new ChatAccessError('Note not found', 404);
}

/* ------------------------------------------------------------ chat opening */

export async function openChatWithContact(input: {
  companyId: string;
  contactId: string;
  whatsappNumberId?: string;
  /** Agent starting the conversation — they own the resulting lead. */
  userId?: string;
}) {
  const companyOid = new Types.ObjectId(input.companyId);
  const contact = await ContactModel.findOne({
    _id: new Types.ObjectId(input.contactId),
    companyId: companyOid,
    deletedAt: null,
  }).lean();
  if (!contact) throw new Error('Contact not found');

  let waId: Types.ObjectId;
  if (input.whatsappNumberId) {
    const wa = await WhatsappNumberModel.findOne({
      _id: new Types.ObjectId(input.whatsappNumberId),
      companyId: companyOid,
      deletedAt: null,
    }).lean();
    if (!wa) throw new Error('WhatsApp sender not found');
    waId = wa._id as Types.ObjectId;
  } else {
    const wa = await WhatsappNumberModel.findOne({
      companyId: companyOid,
      deletedAt: null,
    })
      .sort({ isDefault: -1, updatedAt: -1 })
      .lean();
    if (!wa) throw new Error('No WhatsApp sender configured — add one in Settings');
    waId = wa._id as Types.ObjectId;
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
    .lean()) as unknown as ChatListRow | null;
  if (!populated) throw new Error('Chat not found');
  const [decorated] = await decorateChats([populated]);
  return decorated;
}

export async function ensureInboundChat(input: {
  companyId: string;
  contactPhone: string;
  contactName?: string;
  whatsappNumberId: Types.ObjectId;
}): Promise<{ chatId: string; contactId: string }> {
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
export async function leadStatusCounts(
  companyId: string,
  viewer: { userId: string; role: 'company_admin' | 'agent' },
) {
  const match: Record<string, unknown> = {
    companyId: new Types.ObjectId(companyId),
    deletedAt: null,
  };
  if (viewer.role !== 'company_admin') match.assignedTo = new Types.ObjectId(viewer.userId);

  const rows = await ChatModel.aggregate<{ _id: string | null; n: number }>([
    { $match: match },
    { $group: { _id: '$status', n: { $sum: 1 } } },
  ]);
  const counts: Record<string, number> = { new: 0, in_progress: 0, qualified: 0, won: 0, lost: 0 };
  let total = 0;
  for (const r of rows) {
    // A null group is a pre-pipeline chat, which counts as new.
    const key = r._id ?? 'new';
    if (key in counts) counts[key] = (counts[key] ?? 0) + r.n;
    total += r.n;
  }

  const unassigned =
    viewer.role === 'company_admin'
      ? await ChatModel.countDocuments({
          companyId: new Types.ObjectId(companyId),
          deletedAt: null,
          status: openLeadStatusFilter(),
          $or: [{ assignedTo: null }, { assignedTo: { $exists: false } }],
        })
      : 0;

  return { ...counts, total, unassigned };
}
