import crypto from 'crypto';
import { env } from '../../config/env.js';

export function generateWebhookSlug(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function generateWebhookVerifyToken(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export function buildMetaWebhookUrl(webhookSlug: string): string | null {
  if (!env.PUBLIC_API_BASE_URL?.trim() || !webhookSlug) return null;
  const base = env.PUBLIC_API_BASE_URL.replace(/\/$/, '');
  return `${base}/webhooks/meta/whatsapp/${webhookSlug}`;
}

export function verifyMetaSignature(
  rawBody: Buffer,
  signature: string | undefined,
  appSecret: string,
): boolean {
  if (!appSecret.trim()) return false;
  if (!signature?.startsWith('sha256=')) return false;
  const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
  const received = signature.slice('sha256='.length);
  try {
    return crypto.timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

export type MetaWebhookBody = {
  entry?: {
    changes?: {
      field?: string;
      value?: {
        metadata?: { phone_number_id?: string };
        messages?: {
          from?: string;
          id?: string;
          type?: string;
          text?: { body?: string };
          timestamp?: string;
        }[];
        contacts?: { profile?: { name?: string } }[];
        statuses?: {
          id?: string;
          status?: string;
          errors?: {
            code?: number;
            title?: string;
            message?: string;
            error_data?: { details?: string };
          }[];
        }[];
      };
    }[];
  }[];
};

/** First phone_number_id in a messages change (used to resolve tenant before signature check on legacy URL). */
export function extractPhoneNumberId(body: MetaWebhookBody): string | undefined {
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const id = change.value?.metadata?.phone_number_id;
      if (id) return id;
    }
  }
  return undefined;
}

export function normalizeInboundPhone(from: string): string {
  const d = from.replace(/\D/g, '');
  return d ? `+${d}` : from;
}
