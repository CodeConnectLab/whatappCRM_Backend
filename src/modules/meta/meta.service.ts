import { Types } from 'mongoose';
import { MetaWhatsappConfigModel } from './meta-whatsapp-config.model.js';
import { decryptSecret } from '../../utils/encryption.js';
import { logger } from '../../utils/logger.js';

const GRAPH_API_VERSION = 'v21.0';

function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, '');
}

type MetaGraphTextResponse = {
  messages?: { id: string }[];
  error?: { message: string };
};

export async function sendMetaWhatsappMessage(input: {
  companyId: string;
  wa: { metaPhoneNumberId?: string | null; phoneNumber: string };
  toPhone: string;
  body: string;
  mediaUrl?: string[];
}): Promise<{ sid: string }> {
  const cfg = await MetaWhatsappConfigModel.findOne({
    companyId: new Types.ObjectId(input.companyId),
    deletedAt: null,
  }).lean();
  if (!cfg) throw new Error('Meta WhatsApp credentials not configured in Settings');

  const phoneNumberId = input.wa.metaPhoneNumberId?.trim();
  if (!phoneNumberId) throw new Error('Meta phone number id missing on sender');

  const token = decryptSecret(cfg.accessTokenEncrypted);
  const to = digitsOnly(input.toPhone);
  if (!to) throw new Error('Invalid recipient phone');

  const url = `https://graph.facebook.com/${GRAPH_API_VERSION}/${phoneNumberId}/messages`;

  let payload: Record<string, unknown>;

  if (input.mediaUrl?.length) {
    const link = input.mediaUrl[0]!;
    payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'image',
      image: { link },
      ...(input.body.trim() ? { caption: input.body } : {}),
    };
  } else {
    payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'text',
      text: { preview_url: false, body: input.body },
    };
  }

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const json = (await res.json()) as MetaGraphTextResponse;
  if (!res.ok) {
    logger.warn('Meta WhatsApp send failed', { status: res.status, json });
    throw new Error(json.error?.message ?? `Meta send failed (${res.status})`);
  }

  const sid = json.messages?.[0]?.id ?? '';
  if (!sid) throw new Error('Meta send: no message id');
  logger.info('Meta WhatsApp message created', { sid, companyId: input.companyId });
  return { sid };
}
