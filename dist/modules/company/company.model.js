import { Schema } from "mongoose";
import { getModel } from "../../utils/registerModel.js";
const companySchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true },
    /** Preferred messaging stack for new setup; each sender row also has `provider`. */
    whatsappProvider: {
      type: String,
      enum: ["twilio", "meta"],
      default: "twilio"
    },
    settings: { type: Schema.Types.Mixed, default: {} },
    deletedAt: { type: Date }
  },
  { timestamps: true }
);
companySchema.index({ slug: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
const CompanyModel = getModel("Company", companySchema);
export {
  CompanyModel
};
