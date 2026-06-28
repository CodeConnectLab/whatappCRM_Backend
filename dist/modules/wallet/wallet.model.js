import { Schema } from "mongoose";
import { getModel } from "../../utils/registerModel.js";
const walletSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: "Company", required: true, unique: true },
    balance: { type: Number, default: 0 },
    currency: { type: String, default: "credits" }
  },
  { timestamps: true }
);
const WalletModel = getModel("Wallet", walletSchema);
export {
  WalletModel
};
