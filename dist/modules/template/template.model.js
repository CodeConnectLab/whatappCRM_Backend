import { Schema } from "mongoose";
import { getModel } from "../../utils/registerModel.js";
const templateSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    name: { type: String, required: true, trim: true },
    body: { type: String, required: true },
    /** Optional public HTTPS URL; sent as WhatsApp media when starting campaigns. */
    imageUrl: { type: String, trim: true },
    language: { type: String, default: "en" },
    deletedAt: { type: Date }
  },
  { timestamps: true }
);
templateSchema.index({ companyId: 1, name: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
const TemplateModel = getModel("Template", templateSchema);
export {
  TemplateModel
};
