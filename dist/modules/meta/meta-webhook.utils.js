import crypto from 'crypto';
import { env } from '../../config/env.js';
export function generateWebhookSlug() {
    return crypto.randomBytes(16).toString('hex');
}
export function generateWebhookVerifyToken() {
    return crypto.randomBytes(24).toString('base64url');
}
export function buildMetaWebhookUrl(webhookSlug) {
    if (!env.PUBLIC_API_BASE_URL?.trim() || !webhookSlug)
        return null;
    const base = env.PUBLIC_API_BASE_URL.replace(/\/$/, '');
    return `${base}/webhooks/meta/whatsapp/${webhookSlug}`;
}
export function verifyMetaSignature(rawBody, signature, appSecret) {
    if (!appSecret.trim())
        return false;
    if (!signature?.startsWith('sha256='))
        return false;
    const expected = crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex');
    const received = signature.slice('sha256='.length);
    try {
        return crypto.timingSafeEqual(Buffer.from(received, 'hex'), Buffer.from(expected, 'hex'));
    }
    catch {
        return false;
    }
}
/** First phone_number_id in a messages change (used to resolve tenant before signature check on legacy URL). */
export function extractPhoneNumberId(body) {
    for (const entry of body.entry ?? []) {
        for (const change of entry.changes ?? []) {
            const id = change.value?.metadata?.phone_number_id;
            if (id)
                return id;
        }
    }
    return undefined;
}
export function normalizeInboundPhone(from) {
    const d = from.replace(/\D/g, '');
    return d ? `+${d}` : from;
}
/**
 * Readable body for any inbound message type.
 *
 * Non-text messages used to be dropped on the floor, which silently lost every lead
 * whose first contact was an image or an ad button tap. Everything now lands in the
 * inbox with a caption or a `[type]` placeholder so the conversation is never missed.
 */
export function inboundMessageText(m) {
    switch (m.type) {
        case 'text':
            return m.text?.body ?? '';
        case 'image':
            return m.image?.caption ?? '[image]';
        case 'video':
            return m.video?.caption ?? '[video]';
        case 'document':
            return m.document?.caption ?? `[document${m.document?.filename ? `: ${m.document.filename}` : ''}]`;
        case 'audio':
            return '[voice message]';
        case 'sticker':
            return '[sticker]';
        case 'location': {
            const loc = m.location;
            const label = loc?.name ?? loc?.address;
            if (label)
                return `[location: ${label}]`;
            if (loc?.latitude != null && loc?.longitude != null) {
                return `[location: ${loc.latitude}, ${loc.longitude}]`;
            }
            return '[location]';
        }
        case 'contacts': {
            const names = (m.contacts ?? [])
                .map((c) => c.name?.formatted_name)
                .filter((n) => Boolean(n));
            return names.length ? `[contact: ${names.join(', ')}]` : '[contact card]';
        }
        case 'button':
            return m.button?.text ?? '[button]';
        case 'interactive':
            return (m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? '[interactive reply]');
        case 'reaction':
            return m.reaction?.emoji ? `[reacted ${m.reaction.emoji}]` : '[reaction]';
        case 'order':
            return m.order?.text ?? '[order]';
        case 'unsupported':
            return '[unsupported message]';
        default:
            return m.type ? `[${m.type}]` : '[message]';
    }
}
/**
 * `source_type` is "ad" for a true Click-to-WhatsApp ad and "post" for a boosted post;
 * only the former carries a `ctwa_clid` worth sending back through the Conversions API.
 */
export function normalizeReferral(ref) {
    if (!ref)
        return undefined;
    const out = {
        ctwaClid: ref.ctwa_clid,
        sourceId: ref.source_id,
        sourceType: ref.source_type,
        sourceUrl: ref.source_url,
        headline: ref.headline,
        adBody: ref.body,
        mediaType: ref.media_type,
        imageUrl: ref.image_url,
        videoUrl: ref.video_url,
        thumbnailUrl: ref.thumbnail_url,
    };
    const hasAny = Object.values(out).some((v) => typeof v === 'string' && v.length > 0);
    return hasAny ? out : undefined;
}
