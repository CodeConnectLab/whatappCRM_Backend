import { Types } from 'mongoose';
import { TransactionModel } from './transaction.model.js';
import { WalletModel } from './wallet.model.js';

const CREDIT_PER_MESSAGE = 1;

export function getCreditPerMessage(): number {
  return CREDIT_PER_MESSAGE;
}

export async function ensureWallet(companyId: string): Promise<void> {
  await WalletModel.updateOne(
    { companyId: new Types.ObjectId(companyId) },
    { $setOnInsert: { balance: 100, currency: 'credits' } },
    { upsert: true },
  );
}

export async function getWallet(companyId: string) {
  await ensureWallet(companyId);
  const w = await WalletModel.findOne({ companyId: new Types.ObjectId(companyId) }).lean();
  if (!w) throw new Error('Wallet missing');
  return w;
}

export async function debitCredits(
  companyId: string,
  amount: number,
  reason: string,
  ref?: unknown,
): Promise<void> {
  const wallet = await WalletModel.findOne({ companyId: new Types.ObjectId(companyId) });
  if (!wallet) throw new Error('Wallet not found');
  if (wallet.balance < amount) throw new Error('Insufficient credits');
  wallet.balance -= amount;
  await wallet.save();
  await TransactionModel.create({
    companyId: new Types.ObjectId(companyId),
    type: 'debit',
    amount,
    balanceAfter: wallet.balance,
    reason,
    ref,
  });
}

export async function creditCredits(
  companyId: string,
  amount: number,
  reason: string,
  ref?: unknown,
): Promise<void> {
  const wallet = await WalletModel.findOneAndUpdate(
    { companyId: new Types.ObjectId(companyId) },
    { $inc: { balance: amount } },
    { new: true, upsert: true },
  );
  if (!wallet) throw new Error('Wallet not found');
  await TransactionModel.create({
    companyId: new Types.ObjectId(companyId),
    type: 'credit',
    amount,
    balanceAfter: wallet.balance,
    reason,
    ref,
  });
}
