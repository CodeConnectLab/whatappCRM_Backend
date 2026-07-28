import { Types } from 'mongoose';
import { WhatsappNumberModel } from '../twilio/whatsapp-number.model.js';
import { sendTwilioWhatsappMessage } from '../twilio/twilio.service.js';
import { sendMetaWhatsappMessage, sendMetaWhatsappTemplate } from '../meta/meta.service.js';

export async function sendWhatsappMessage(input: {
  companyId: string;
  whatsappNumberId: string;
  toPhone: string;
  body: string;
  mediaUrl?: string[];
}): Promise<{ sid: string }> {
  const wa = await WhatsappNumberModel.findOne({
    _id: new Types.ObjectId(input.whatsappNumberId),
    companyId: new Types.ObjectId(input.companyId),
    deletedAt: null,
  }).lean();
  if (!wa) throw new Error('WhatsApp sender not found');

  const provider = wa.provider ?? 'twilio';
  if (provider === 'meta') {
    return sendMetaWhatsappMessage({
      companyId: input.companyId,
      wa,
      toPhone: input.toPhone,
      body: input.body,
      mediaUrl: input.mediaUrl,
    });
  }

  return sendTwilioWhatsappMessage({
    companyId: input.companyId,
    fromNumber: wa.phoneNumber,
    toPhone: input.toPhone,
    body: input.body,
    mediaUrl: input.mediaUrl,
  });
}

/**
 * Template send — the only way to reach a contact outside the 24-hour window.
 * Twilio has no separate template API here: an approved template is delivered by
 * sending its rendered text, so `renderedBody` is used for that provider.
 */
export async function sendWhatsappTemplateMessage(input: {
  companyId: string;
  whatsappNumberId: string;
  toPhone: string;
  templateName: string;
  language: string;
  parameters: string[];
  /** Text with variables already substituted — used by Twilio, and as fallback. */
  renderedBody: string;
  headerImageUrl?: string;
}): Promise<{ sid: string }> {
  const wa = await WhatsappNumberModel.findOne({
    _id: new Types.ObjectId(input.whatsappNumberId),
    companyId: new Types.ObjectId(input.companyId),
    deletedAt: null,
  }).lean();
  if (!wa) throw new Error('WhatsApp sender not found');

  const provider = wa.provider ?? 'twilio';
  if (provider === 'meta') {
    return sendMetaWhatsappTemplate({
      companyId: input.companyId,
      wa,
      toPhone: input.toPhone,
      templateName: input.templateName,
      language: input.language,
      parameters: input.parameters,
      ...(input.headerImageUrl ? { headerImageUrl: input.headerImageUrl } : {}),
    });
  }

  return sendTwilioWhatsappMessage({
    companyId: input.companyId,
    fromNumber: wa.phoneNumber,
    toPhone: input.toPhone,
    body: input.renderedBody,
    ...(input.headerImageUrl ? { mediaUrl: [input.headerImageUrl] } : {}),
  });
}
