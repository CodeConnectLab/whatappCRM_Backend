import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { getModel } from '../../utils/registerModel.js';

const walletSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, unique: true },
    balance: { type: Number, default: 0 },
    currency: { type: String, default: 'credits' },
  },
  { timestamps: true },
);

export type Wallet = InferSchemaType<typeof walletSchema>;
export const WalletModel: Model<Wallet> = getModel<Wallet>('Wallet', walletSchema);
