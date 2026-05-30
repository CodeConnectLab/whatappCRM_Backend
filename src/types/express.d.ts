declare global {
  namespace Express {
    interface Request {
      user?: { sub: string; email: string; isSuperAdmin: boolean };
      companyId?: string;
      membershipRole?: 'company_admin' | 'agent';
    }
  }
}

export type JwtPayload = {
  sub: string;
  email: string;
  isSuperAdmin: boolean;
  typ: 'access' | 'refresh';
};

export {};
