import { Types } from 'mongoose';
import { WhatsappNumberModel } from '../twilio/whatsapp-number.model.js';
import { sendTwilioWhatsappMessage } from '../twilio/twilio.service.js';
import { sendMetaWhatsappMessage } from '../meta/meta.service.js';

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
