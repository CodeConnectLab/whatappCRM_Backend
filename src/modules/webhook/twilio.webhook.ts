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

    const msg = await MessageModel.create({
      companyId: new Types.ObjectId(companyId),
      chatId: new Types.ObjectId(chatId),
      direction: 'inbound',
      body,
      status: 'delivered',
      twilioSid: sid,
    });

    const created = await MessageModel.findById(msg._id).lean();

    await ChatModel.updateOne(
      { _id: chatId },
      {
        $set: { lastMessageAt: new Date(), lastMessagePreview: body.slice(0, 140) },
        $inc: { unreadCount: 1 },
      },
    );

    emitToCompany(companyId, 'message:new', { chatId, message: created });

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
