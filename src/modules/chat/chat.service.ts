import { Types } from 'mongoose';
import { ChatModel } from './chat.model.js';
import { ContactModel } from '../contact/contact.model.js';
import { MessageModel } from './message.model.js';
import { WhatsappNumberModel } from '../twilio/whatsapp-number.model.js';
import { emitToCompany } from '../../socket/io.js';
import { debitCredits, getCreditPerMessage } from '../wallet/wallet.service.js';
import { sendWhatsappMessage } from '../messaging/messaging.service.js';
import { logger } from '../../utils/logger.js';

export async function listChats(companyId: string) {
  return ChatModel.find({ companyId: new Types.ObjectId(companyId), deletedAt: null })
    .sort({ lastMessageAt: -1 })
    .populate('contactId', 'name phone')
    .lean();
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
  return rows.reverse();
}

export async function sendOutboundChatMessage(input: {
  companyId: string;
  userId: string;
  chatId: string;
  body: string;
}) {
  const chat = await ChatModel.findOne({
    _id: new Types.ObjectId(input.chatId),
    companyId: new Types.ObjectId(input.companyId),
    deletedAt: null,
  }).lean();
  if (!chat) throw new Error('Chat not found');

  const contact = await ContactModel.findById(chat.contactId).lean();
  if (!contact) throw new Error('Contact not found');
  const wa = await WhatsappNumberModel.findOne({
    _id: chat.whatsappNumberId,
    companyId: new Types.ObjectId(input.companyId),
    deletedAt: null,
  }).lean();
  if (!wa) throw new Error('WhatsApp number not configured');

  const msgDoc = await MessageModel.create({
    companyId: new Types.ObjectId(input.companyId),
    chatId: new Types.ObjectId(input.chatId),
    direction: 'outbound',
    body: input.body,
    status: 'queued',
    senderUserId: new Types.ObjectId(input.userId),
  });

  try {
    const { sid } = await sendWhatsappMessage({
      companyId: input.companyId,
      whatsappNumberId: String(wa._id),
      toPhone: contact.phone,
      body: input.body,
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

    await ChatModel.updateOne(
      { _id: chat._id },
      {
        $set: {
          lastMessageAt: new Date(),
          lastMessagePreview: input.body.slice(0, 140),
        },
      },
    );
    const updated = await MessageModel.findById(msgDoc._id).lean();
    emitToCompany(input.companyId, 'message:new', { chatId: input.chatId, message: updated });
    return updated;
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

export async function openChatWithContact(input: {
  companyId: string;
  contactId: string;
  whatsappNumberId?: string;
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
    });
  }

  const populated = await ChatModel.findById(chat._id)
    .populate('contactId', 'name phone')
    .lean();
  if (!populated) throw new Error('Chat not found');
  return populated;
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
