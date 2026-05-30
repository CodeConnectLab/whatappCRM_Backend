import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { CompanyModel } from '../company/company.model.js';
import { TransactionModel } from './transaction.model.js';
import { parsePagination, paginate } from '../../utils/pagination.js';
import { getWallet } from './wallet.service.js';

export async function getWalletCtrl(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const w = await getWallet(companyId);
  res.json(w);
}

export async function listTransactions(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const opts = parsePagination(req.query as Record<string, unknown>);
  const filter = { companyId: new Types.ObjectId(companyId) };
  const result = await paginate(TransactionModel, filter, opts);
  res.json(result);
}

export async function updateCompanySettings(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const { name, settings, whatsappProvider } = req.body as {
    name?: string;
    settings?: Record<string, unknown>;
    whatsappProvider?: 'twilio' | 'meta';
  };
  const c = await CompanyModel.findOneAndUpdate(
    { _id: new Types.ObjectId(companyId), deletedAt: null },
    {
      $set: {
        ...(name ? { name } : {}),
        ...(settings ? { settings } : {}),
        ...(whatsappProvider ? { whatsappProvider } : {}),
      },
    },
    { new: true },
  );
  if (!c) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(c);
}
