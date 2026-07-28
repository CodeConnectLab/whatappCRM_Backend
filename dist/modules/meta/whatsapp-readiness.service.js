import { Types } from "mongoose";
import { MetaWhatsappConfigModel } from "./meta-whatsapp-config.model.js";
import { WhatsappNumberModel } from "../twilio/whatsapp-number.model.js";
import { TemplateModel } from "../template/template.model.js";
import { getWallet, getCreditPerMessage } from "../wallet/wallet.service.js";
async function getMetaReadiness(companyId) {
  const oid = new Types.ObjectId(companyId);
  const [metaCfg, senders] = await Promise.all([
    MetaWhatsappConfigModel.findOne({ companyId: oid, deletedAt: null }).lean(),
    WhatsappNumberModel.find({ companyId: oid, provider: "meta", deletedAt: null }).lean()
  ]);
  const credentialsConfigured = Boolean(metaCfg?.accessTokenEncrypted && metaCfg?.appSecretEncrypted);
  const senderConfigured = senders.some((s) => Boolean(s.metaPhoneNumberId?.trim()));
  const webhookVerified = metaCfg?.webhookVerificationStatus === "verified";
  const defaultSender = senders.find((s) => s.isDefault && s.metaPhoneNumberId) ?? senders.find((s) => s.metaPhoneNumberId);
  const issues = [];
  if (!credentialsConfigured) issues.push("Meta access token and app secret are not saved");
  if (!senderConfigured) issues.push("No Meta WhatsApp sender (phone number ID) configured");
  if (!webhookVerified) issues.push("Meta webhook is not verified yet");
  return {
    credentialsConfigured,
    senderConfigured,
    webhookVerified,
    defaultSenderId: defaultSender ? String(defaultSender._id) : void 0,
    readyForOutbound: credentialsConfigured && senderConfigured,
    issues
  };
}
async function assertCampaignCanStart(companyId, input) {
  if (input.recipientCount <= 0) {
    throw new Error("Campaign has no recipients \u2014 add a contact group or contacts");
  }
  if (!input.templateId) {
    throw new Error("Campaign needs a message template before starting");
  }
  const readiness = await getMetaReadiness(companyId);
  if (!readiness.credentialsConfigured) {
    throw new Error("Meta credentials are not configured \u2014 open Settings and save access token + app secret");
  }
  if (!readiness.webhookVerified) {
    throw new Error("Meta webhook is not verified \u2014 paste the callback URL and verify token in Meta Developer Console");
  }
  const wa = await WhatsappNumberModel.findOne({
    _id: input.whatsappNumberId,
    companyId: new Types.ObjectId(companyId),
    deletedAt: null
  }).lean();
  if (!wa) throw new Error("WhatsApp sender not found for this workspace");
  if (wa.provider === "meta" && !wa.metaPhoneNumberId?.trim()) {
    throw new Error("Selected Meta sender is missing phone number ID");
  }
  if (wa.provider === "meta") {
    const tpl = await TemplateModel.findById(input.templateId).lean();
    if (!tpl) throw new Error("Campaign template not found");
    if (tpl.status !== "APPROVED") {
      const state = String(tpl.status ?? "local").toLowerCase();
      throw new Error(
        `Template "${tpl.name}" is ${state} \u2014 submit it for Meta approval and wait until it is approved before starting a campaign`
      );
    }
  }
  const wallet = await getWallet(companyId);
  const needed = input.recipientCount * getCreditPerMessage();
  if (wallet.balance < needed) {
    throw new Error(`Insufficient credits: need ${needed}, wallet has ${wallet.balance}`);
  }
}
export {
  assertCampaignCanStart,
  getMetaReadiness
};
