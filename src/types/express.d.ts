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
  /** Token version at signing time; checked against the user row on every request. */
  tv: number;
  typ: 'access' | 'refresh';
};

export {};
