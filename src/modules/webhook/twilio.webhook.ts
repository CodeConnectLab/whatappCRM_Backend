import type { Request, Response } from 'express';
import twilio from 'twilio';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { MessageModel } from '../chat/message.model.js';
import { WebhookLogModel } from './webhook-log.model.js';
import { WhatsappNumberModel } from '../twilio/whatsapp-number.model.js';
import { emitToCompany } from '../../socket/io.js';
import { logger } from '../../utils/logger.js';
import { ensureInboundChat } from '../chat/chat.service.js';
import { ChatModel } from '../chat/chat.model.js';
import { autoAssignChat } from '../chat/lead-assignment.service.js';
import { matchProductForLead } from '../product/product.service.js';
import { runAutoResponsesForInbound } from '../automation/auto-response.service.js';
import { ingestTwilioInboundMedia } from '../media/inbound-media.service.js';

function validateTwilio(req: Request): boolean {
  if (!env.TWILIO_WEBHOOK_AUTH_TOKEN) return true;
  const signature = req.header('x-twilio-signature');
  if (!signature) return false;
  const rawProto = req.headers['x-forwarded-proto'];
  const proto = Array.isArray(rawProto) ? rawProto[0] : (rawProto ?? req.protocol);
  const host = req.get('host') ?? 'localhost';
  const url = `${proto}://${host}${req.originalUrl}`;
  return twilio.validateRequest(
    env.TWILIO_WEBHOOK_AUTH_TOKEN,
    signature,
    url,
    req.body as Record<string, string>,
  );
}

export async function twilioIncomingController(req: Request, res: Response): Promise<void> {
  const signatureValid = validateTwilio(req);
  const companyIdHeader = req.header('x-company-id');

  try {
    const payload = req.body as Record<string, string>;
    await WebhookLogModel.create({
      companyId:
        companyIdHeader && Types.ObjectId.isValid(companyIdHeader)
          ? new Types.ObjectId(companyIdHeader)
          : undefined,
      path: req.path,
      payload,
      headers: req.headers,
      signatureValid,
    });

    if (!signatureValid) {
      res.status(401).send('Invalid signature');
      return;
    }

    const from = (payload.From ?? '').replace('whatsapp:', '');
    const to = (payload.To ?? '').replace('whatsapp:', '');
    const body = payload.Body ?? '';
    const sid = payload.MessageSid ?? payload.SmsSid ?? '';

    const wa = await WhatsappNumberModel.findOne({
      phoneNumber: to,
      deletedAt: null,
    }).lean();
    if (!wa) {
      logger.warn('Unknown inbound WhatsApp number', { to });
      res.type('text/xml').send('<Response></Response>');
      return;
    }

    const companyId = String(wa.companyId);
    const { chatId } = await ensureInboundChat({
      companyId,
      contactPhone: from,
      contactName: payload.ProfileName,
      whatsappNumberId: wa._id,
    });

    const mediaUrl = payload.MediaUrl0;
    const mediaContentType = payload.MediaContentType0;
    const preview = body.trim() || (mediaUrl ? '[attachment]' : '');

    const msg = await MessageModel.create({
      companyId: new Types.ObjectId(companyId),
      chatId: new Types.ObjectId(chatId),
      direction: 'inbound',
      body: preview,
      messageType: mediaContentType ? mediaContentType.split('/')[0] : 'text',
      status: 'delivered',
      twilioSid: sid,
    });

    const created = await MessageModel.findById(msg._id).lean();

    const existingChat = await ChatModel.findById(chatId).select('firstInboundAt').lean();
    const isFirstInbound = !existingChat?.firstInboundAt;

    const chatUpdate: Record<string, unknown> = {
      lastMessageAt: new Date(),
      lastMessagePreview: preview.slice(0, 140),
    };
    if (isFirstInbound) {
      chatUpdate.firstInboundMessage = preview;
      chatUpdate.firstInboundAt = new Date();
    }

    await ChatModel.updateOne(
      { _id: chatId },
      { $set: chatUpdate, $inc: { unreadCount: 1 } },
    );

    emitToCompany(companyId, 'message:new', { chatId, message: created });

    // Detached: Twilio also drops a webhook that takes too long to answer.
    if (mediaUrl) {
      void ingestTwilioInboundMedia({
        companyId,
        chatId,
        messageId: String(msg._id),
        mediaUrl,
        ...(mediaContentType ? { mimeTypeHint: mediaContentType } : {}),
      }).catch((err: unknown) => {
        logger.error('Twilio media: unhandled ingest error', { companyId, chatId, err });
      });
    }

    void (async () => {
      if (isFirstInbound) {
        const product = await matchProductForLead({
          companyId,
          messageBody: preview,
          whatsappNumberId: String(wa._id),
        });
        if (product) {
          await ChatModel.updateOne(
            { _id: chatId },
            { $set: { productId: new Types.ObjectId(product.productId) } },
          );
        }
        await autoAssignChat(companyId, chatId);
      }
      await runAutoResponsesForInbound({
        companyId,
        chatId,
        messageBody: preview,
        isFirstInbound,
      });
    })().catch((err: unknown) => {
      logger.error('Twilio lead intake pipeline failed', { companyId, chatId, err });
    });

    res.type('text/xml').send('<Response></Response>');
  } catch (e) {
    logger.error('twilio incoming error', { err: e });
    res.status(500).send('error');
  }
}

export async function twilioStatusController(req: Request, res: Response): Promise<void> {
  const signatureValid = validateTwilio(req);
  try {
    const payload = req.body as Record<string, string>;
    await WebhookLogModel.create({
      path: req.path,
      payload,
      signatureValid,
    });
    if (!signatureValid) {
      res.status(401).send('Invalid signature');
      return;
    }
    const sid = payload.MessageSid ?? '';
    const status = (payload.MessageStatus ?? '').toLowerCase();
    const map: Record<string, 'delivered' | 'read' | 'failed' | 'sent'> = {
      delivered: 'delivered',
      read: 'read',
      failed: 'failed',
      sent: 'sent',
    };
    const next = map[status];
    if (sid && next) {
      await MessageModel.updateMany({ twilioSid: sid }, { $set: { status: next } });
    }
    res.sendStatus(204);
  } catch (e) {
    logger.error('twilio status error', { err: e });
    res.status(500).send('error');
  }
}
