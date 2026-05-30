import type { NextFunction, Request, Response } from 'express';

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction): void {
  if (!req.user?.isSuperAdmin) {
    res.status(403).json({ error: 'Super admin only' });
    return;
  }
  next();
}

export function requireCompanyAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.isSuperAdmin) {
    next();
    return;
  }
  if (req.membershipRole === 'company_admin') {
    next();
    return;
  }
  res.status(403).json({ error: 'Company admin required' });
}

export function requireAgent(req: Request, res: Response, next: NextFunction): void {
  if (req.membershipRole === 'company_admin' || req.membershipRole === 'agent') {
    next();
    return;
  }
  res.status(403).json({ error: 'Agent access required' });
}
