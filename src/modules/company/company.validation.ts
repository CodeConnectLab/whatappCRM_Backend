import { z } from 'zod';

export const companyValidation = {
  adminCreateCompany: z.object({ name: z.string().min(1) }),
  creditWallet: z.object({
    companyId: z.string().regex(/^[a-f0-9]{24}$/i),
    amount: z.number().positive(),
    reason: z.string().optional(),
  }),
  promoteSuperAdmin: z.object({
    userId: z.string().regex(/^[a-f0-9]{24}$/i),
    isSuperAdmin: z.boolean(),
  }),
  inviteMember: z.object({
    email: z.string().email(),
    role: z.enum(['company_admin', 'agent']),
  }),
  createUser: z.object({
    name: z.string().trim().min(1).max(160),
    email: z.string().email(),
    /** Set by the admin and handed to the person; they are asked to change it on login. */
    password: z.string().min(8).max(128),
    role: z.enum(['company_admin', 'agent']),
    availableForLeads: z.boolean().optional(),
  }),
  updateMember: {
    params: z.object({ id: z.string().regex(/^[a-f0-9]{24}$/i) }),
    body: z
      .object({
        role: z.enum(['company_admin', 'agent']).optional(),
        availableForLeads: z.boolean().optional(),
      })
      .refine((v) => v.role !== undefined || v.availableForLeads !== undefined, {
        message: 'Nothing to update',
      }),
  },
  memberById: {
    params: z.object({ id: z.string().regex(/^[a-f0-9]{24}$/i) }),
  },
  resetMemberPassword: {
    params: z.object({ id: z.string().regex(/^[a-f0-9]{24}$/i) }),
    body: z.object({ password: z.string().min(8).max(128) }),
  },
  updateCompanySettings: z.object({
    name: z.string().optional(),
    whatsappProvider: z.enum(['twilio', 'meta']).optional(),
    settings: z.record(z.string(), z.unknown()).optional(),
  }),
};
