import type { Request, Response } from 'express';
import { getMeProfile } from './user.service.js';

export async function me(req: Request, res: Response): Promise<void> {
  const data = await getMeProfile(req.user!.sub);
  if (!data) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(data);
}
