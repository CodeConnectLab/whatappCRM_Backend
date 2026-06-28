import crypto from "crypto";
import { env } from "../../config/env.js";
function generateWebhookSlug() {
  return crypto.randomBytes(16).toString("hex");
}
function generateWebhookVerifyToken() {
  return crypto.randomBytes(24).toString("base64url");
}
function buildMetaWebhookUrl(webhookSlug) {
  if (!env.PUBLIC_API_BASE_URL?.trim() || !webhookSlug) return null;
  const base = env.PUBLIC_API_BASE_URL.replace(/\/$/, "");
  return `${base}/webhooks/meta/whatsapp/${webhookSlug}`;
}
function verifyMetaSignature(rawBody, signature, appSecret) {
  if (!appSecret.trim()) return false;
  if (!signature?.startsWith("sha256=")) return false;
  const expected = crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex");
  const received = signature.slice("sha256=".length);
  try {
    return crypto.timingSafeEqual(Buffer.from(received, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}
function extractPhoneNumberId(body) {
  for (const entry of body.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const id = change.value?.metadata?.phone_number_id;
      if (id) return id;
    }
  }
  return void 0;
}
function normalizeInboundPhone(from) {
  const d = from.replace(/\D/g, "");
  return d ? `+${d}` : from;
}
export {
  buildMetaWebhookUrl,
  extractPhoneNumberId,
  generateWebhookSlug,
  generateWebhookVerifyToken,
  normalizeInboundPhone,
  verifyMetaSignature
};
