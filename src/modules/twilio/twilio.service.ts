import twilio from 'twilio';
import { Types } from 'mongoose';
import { env } from '../../config/env.js';
import { TwilioAccountModel } from './twilio-account.model.js';
import { decryptSecret } from '../../utils/encryption.js';
import { logger } from '../../utils/logger.js';

function twilioStatusCallbackUrl(): string | undefined {
  const base = env.PUBLIC_API_BASE_URL?.trim().replace(/\/$/, '');
  if (!base) return undefined;
  return `${base}/webhooks/twilio/status`;
}

export async function getTwilioClientForCompany(companyId: string): Promise<twilio.Twilio | null> {
  const acc = await TwilioAccountModel.findOne({
    companyId: new Types.ObjectId(companyId),
    deletedAt: null,
  }).lean();
  if (!acc) return null;
  const token = decryptSecret(acc.authTokenEncrypted);
  return twilio(acc.accountSid, token);
}

export async function sendTwilioWhatsappMessage(input: {
  companyId: string;
  fromNumber: string;
  toPhone: string;
  body: string;
  mediaUrl?: string[];
}): Promise<{ sid: string }> {
  const client = await getTwilioClientForCompany(input.companyId);
  if (!client) throw new Error('Twilio not configured');
  const from = input.fromNumber.startsWith('whatsapp:')
    ? input.fromNumber
    : `whatsapp:${input.fromNumber}`;
  const to = input.toPhone.startsWith('whatsapp:') ? input.toPhone : `whatsapp:${input.toPhone}`;
  const statusCallback = twilioStatusCallbackUrl();
  const msg = await client.messages.create({
    from,
    to,
    body: input.body,
    ...(input.mediaUrl?.length ? { mediaUrl: input.mediaUrl } : {}),
    ...(statusCallback
      ? { statusCallback, statusCallbackMethod: 'POST' as const }
      : {}),
  });
  logger.info('Twilio message created', { sid: msg.sid, companyId: input.companyId });
  return { sid: msg.sid };
}
