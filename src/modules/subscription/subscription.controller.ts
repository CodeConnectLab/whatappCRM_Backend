import type { Request, Response } from 'express';
import { getSubscriptionSnapshot } from './subscription.service.js';

export async function getSubscription(req: Request, res: Response): Promise<void> {
  const snapshot = await getSubscriptionSnapshot(req.companyId!);
  if (!snapshot) {
    res.status(404).json({ error: 'Company not found' });
    return;
  }
  res.json(snapshot);
}
