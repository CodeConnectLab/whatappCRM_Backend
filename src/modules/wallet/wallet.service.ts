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

/**
 * Debits only if the balance covers it, in one atomic update.
 *
 * The read-modify-write in `debitCredits` can let two concurrent sends both pass the
 * balance check; the conditional update cannot. Returns false instead of throwing so a
 * caller can decide whether that means "skip this message" or "stop the campaign".
 */
export async function tryDebitCredits(
  companyId: string,
  amount: number,
  reason: string,
  ref?: unknown,
): Promise<boolean> {
  if (amount <= 0) return true;
  const wallet = await WalletModel.findOneAndUpdate(
    { companyId: new Types.ObjectId(companyId), balance: { $gte: amount } },
    { $inc: { balance: -amount } },
    { new: true },
  );
  if (!wallet) return false;
  await TransactionModel.create({
    companyId: new Types.ObjectId(companyId),
    type: 'debit',
    amount,
    balanceAfter: wallet.balance,
    reason,
    ref,
  });
  return true;
}

/** Returns a debit to the wallet when the send it paid for did not happen. */
export async function refundCredits(
  companyId: string,
  amount: number,
  reason: string,
  ref?: unknown,
): Promise<void> {
  if (amount <= 0) return;
  await creditCredits(companyId, amount, reason, ref);
}

export async function getBalance(companyId: string): Promise<number> {
  const w = await WalletModel.findOne({ companyId: new Types.ObjectId(companyId) })
    .select('balance')
    .lean();
  return w?.balance ?? 0;
}
