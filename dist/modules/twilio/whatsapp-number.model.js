import { Schema } from "mongoose";
import { getModel } from "../../utils/registerModel.js";
const whatsappNumberSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    provider: { type: String, enum: ["twilio", "meta"], default: "twilio" },
    twilioAccountId: { type: Schema.Types.ObjectId, ref: "TwilioAccount" },
    /** WhatsApp Cloud API Graph ID for this sender (from Meta Business). */
    metaPhoneNumberId: { type: String, trim: true },
    phoneNumber: { type: String, required: true, trim: true },
    friendlyName: { type: String, trim: true },
    isDefault: { type: Boolean, default: false },
    deletedAt: { type: Date }
  },
  { timestamps: true }
);
whatsappNumberSchema.index(
  { companyId: 1, phoneNumber: 1 },
  { unique: true, partialFilterExpression: { deletedAt: null } }
);
whatsappNumberSchema.index(
  { companyId: 1, provider: 1 },
  {
    unique: true,
    partialFilterExpression: { provider: "meta", deletedAt: null }
  }
);
whatsappNumberSchema.index(
  { metaPhoneNumberId: 1 },
  { unique: true, sparse: true, partialFilterExpression: { metaPhoneNumberId: { $type: "string" } } }
);
const WhatsappNumberModel = getModel(
  "WhatsappNumber",
  whatsappNumberSchema
);
export {
  WhatsappNumberModel
};
