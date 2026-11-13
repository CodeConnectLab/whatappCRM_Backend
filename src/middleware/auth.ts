import type { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../utils/jwt.js';
import { UserModel } from '../modules/user/user.model.js';

async function authenticate(req: Request, res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const token = header.slice('Bearer '.length);

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    res.status(401).json({ error: 'Invalid token' });
    return;
  }

  /**
   * One lean read so a token stops working the moment the account is deleted or its
   * `tokenVersion` is bumped — a stateless check cannot see either.
   */
  const user = await UserModel.findById(payload.sub).select('tokenVersion deletedAt').lean();
  if (!user || user.deletedAt) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if ((user.tokenVersion ?? 0) !== (payload.tv ?? 0)) {
    res.status(401).json({ error: 'Session ended, please sign in again' });
    return;
  }

  req.user = {
    sub: payload.sub,
    email: payload.email,
    isSuperAdmin: payload.isSuperAdmin,
  };
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  void authenticate(req, res, next).catch(next);
}
