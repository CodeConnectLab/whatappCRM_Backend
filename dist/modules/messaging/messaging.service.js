import { Types } from "mongoose";
import { WhatsappNumberModel } from "../twilio/whatsapp-number.model.js";
import { sendTwilioWhatsappMessage } from "../twilio/twilio.service.js";
import { sendMetaWhatsappMessage, sendMetaWhatsappTemplate } from "../meta/meta.service.js";
async function sendWhatsappMessage(input) {
  const wa = await WhatsappNumberModel.findOne({
    _id: new Types.ObjectId(input.whatsappNumberId),
    companyId: new Types.ObjectId(input.companyId),
    deletedAt: null
  }).lean();
  if (!wa) throw new Error("WhatsApp sender not found");
  const provider = wa.provider ?? "twilio";
  if (provider === "meta") {
    return sendMetaWhatsappMessage({
      companyId: input.companyId,
      wa,
      toPhone: input.toPhone,
      body: input.body,
      mediaUrl: input.mediaUrl
    });
  }
  return sendTwilioWhatsappMessage({
    companyId: input.companyId,
    fromNumber: wa.phoneNumber,
    toPhone: input.toPhone,
    body: input.body,
    mediaUrl: input.mediaUrl
  });
}
async function sendWhatsappTemplateMessage(input) {
  const wa = await WhatsappNumberModel.findOne({
    _id: new Types.ObjectId(input.whatsappNumberId),
    companyId: new Types.ObjectId(input.companyId),
    deletedAt: null
  }).lean();
  if (!wa) throw new Error("WhatsApp sender not found");
  const provider = wa.provider ?? "twilio";
  if (provider === "meta") {
    return sendMetaWhatsappTemplate({
      companyId: input.companyId,
      wa,
      toPhone: input.toPhone,
      templateName: input.templateName,
      language: input.language,
      parameters: input.parameters,
      ...input.headerImageUrl ? { headerImageUrl: input.headerImageUrl } : {}
    });
  }
  return sendTwilioWhatsappMessage({
    companyId: input.companyId,
    fromNumber: wa.phoneNumber,
    toPhone: input.toPhone,
    body: input.renderedBody,
    ...input.headerImageUrl ? { mediaUrl: [input.headerImageUrl] } : {}
  });
}
export {
  sendWhatsappMessage,
  sendWhatsappTemplateMessage
};
