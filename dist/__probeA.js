import { Schema } from "mongoose";
const s = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    name: { type: String, required: true, trim: true },
    body: { type: String, required: true },
    language: { type: String, default: "en" },
    deletedAt: { type: Date }
  },
  { timestamps: true }
);
