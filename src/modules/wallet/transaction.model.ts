import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { getModel } from '../../utils/registerModel.js';

export const TRANSACTION_TYPES = ['credit', 'debit', 'adjustment'] as const;

const transactionSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    type: { type: String, enum: TRANSACTION_TYPES, required: true },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    reason: { type: String, required: true, trim: true },
    ref: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

transactionSchema.index({ companyId: 1, createdAt: -1 });

export type Transaction = InferSchemaType<typeof transactionSchema>;
export const TransactionModel: Model<Transaction> = getModel<Transaction>('Transaction', transactionSchema);
