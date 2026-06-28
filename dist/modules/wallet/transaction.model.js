import { Schema } from "mongoose";
import { getModel } from "../../utils/registerModel.js";
const TRANSACTION_TYPES = ["credit", "debit", "adjustment"];
const transactionSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, index: true },
    type: { type: String, enum: TRANSACTION_TYPES, required: true },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    reason: { type: String, required: true, trim: true },
    ref: { type: Schema.Types.Mixed }
  },
  { timestamps: true }
);
transactionSchema.index({ companyId: 1, createdAt: -1 });
const TransactionModel = getModel("Transaction", transactionSchema);
export {
  TRANSACTION_TYPES,
  TransactionModel
};
