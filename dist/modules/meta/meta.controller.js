import { Types } from "mongoose";
import { MetaWhatsappConfigModel } from "./meta-whatsapp-config.model.js";
import {
  buildMetaWebhookUrl,
  generateWebhookSlug,
  generateWebhookVerifyToken
} from "./meta-webhook.utils.js";
import { encryptSecret } from "../../utils/encryption.js";
import { logActivity } from "../activity/activity.service.js";
async function ensureUniqueWebhookSlug() {
  for (let i = 0; i < 8; i++) {
    const slug = generateWebhookSlug();
    const exists = await MetaWhatsappConfigModel.exists({ webhookSlug: slug });
    if (!exists) return slug;
  }
  throw new Error("Could not allocate webhook slug");
}
function toConfigResponse(doc) {
  const slug = doc.webhookSlug ?? void 0;
  return {
    accessTokenConfigured: Boolean(doc.accessTokenEncrypted),
    appSecretConfigured: Boolean(doc.appSecretEncrypted),
    configured: Boolean(doc.accessTokenEncrypted && doc.appSecretEncrypted),
    wabaId: doc.wabaId ?? void 0,
    webhookSlug: slug,
    webhookUrl: slug ? buildMetaWebhookUrl(slug) : null,
    webhookVerifyToken: doc.webhookVerifyToken ?? void 0,
    webhookVerificationStatus: doc.webhookVerificationStatus ?? "pending",
    webhookVerifiedAt: doc.webhookVerifiedAt?.toISOString(),
    webhookLastVerifyAt: doc.webhookLastVerifyAt?.toISOString(),
    webhookLastVerifyError: doc.webhookLastVerifyError ?? void 0
  };
}
async function getMetaWhatsappConfig(req, res) {
  const companyId = req.companyId;
  const oid = new Types.ObjectId(companyId);
  let doc = await MetaWhatsappConfigModel.findOne({ companyId: oid, deletedAt: null }).lean();
  if (doc && (!doc.webhookSlug || !doc.webhookVerifyToken)) {
    const patch = {};
    if (!doc.webhookSlug) patch.webhookSlug = await ensureUniqueWebhookSlug();
    if (!doc.webhookVerifyToken) patch.webhookVerifyToken = generateWebhookVerifyToken();
    doc = await MetaWhatsappConfigModel.findOneAndUpdate(
      { companyId: oid },
      { $set: patch },
      { new: true }
    ).lean();
  }
  if (!doc) {
    res.json({
      accessTokenConfigured: false,
      appSecretConfigured: false,
      configured: false,
      webhookUrl: null,
      webhookVerificationStatus: "pending"
    });
    return;
  }
  res.json(toConfigResponse(doc));
}
async function upsertMetaWhatsappConfig(req, res) {
  const companyId = req.companyId;
  const body = req.body;
  const oid = new Types.ObjectId(companyId);
  const existing = await MetaWhatsappConfigModel.findOne({ companyId: oid, deletedAt: null }).lean();
  const set = { deletedAt: null };
  if (body.accessToken) {
    set.accessTokenEncrypted = encryptSecret(body.accessToken);
  } else if (!existing?.accessTokenEncrypted) {
    res.status(400).json({ error: "Access token is required on first setup" });
    return;
  }
  if (body.appSecret) {
    set.appSecretEncrypted = encryptSecret(body.appSecret);
  } else if (!existing?.appSecretEncrypted) {
    res.status(400).json({ error: "App secret is required on first setup" });
    return;
  }
  if (body.regenerateWebhookVerifyToken) {
    set.webhookVerifyToken = generateWebhookVerifyToken();
    set.webhookVerificationStatus = "pending";
  } else if (body.webhookVerifyToken) {
    const taken = await MetaWhatsappConfigModel.findOne({
      webhookVerifyToken: body.webhookVerifyToken,
      companyId: { $ne: oid },
      deletedAt: null
    }).lean();
    if (taken) {
      res.status(409).json({ error: "This verify token is already used by another workspace" });
      return;
    }
    set.webhookVerifyToken = body.webhookVerifyToken;
    set.webhookVerificationStatus = "pending";
  } else if (!existing?.webhookVerifyToken) {
    set.webhookVerifyToken = generateWebhookVerifyToken();
  }
  if (!existing?.webhookSlug) {
    set.webhookSlug = await ensureUniqueWebhookSlug();
  }
  if (body.wabaId !== void 0) {
    set.wabaId = body.wabaId || void 0;
  }
  const update = { $set: set, $setOnInsert: { companyId: oid } };
  if (body.regenerateWebhookVerifyToken) {
    update.$unset = { webhookVerifiedAt: "", webhookLastVerifyError: "" };
  }
  const doc = await MetaWhatsappConfigModel.findOneAndUpdate(
    { companyId: oid },
    update,
    { upsert: true, new: true }
  ).lean();
  await logActivity({
    companyId,
    userId: req.user?.sub ?? null,
    action: "meta.whatsapp_config.upsert",
    resource: "meta_whatsapp"
  });
  res.json(toConfigResponse(doc));
}
export {
  getMetaWhatsappConfig,
  upsertMetaWhatsappConfig
};
