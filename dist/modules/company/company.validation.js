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
    updateCompanySettings: z.object({
        name: z.string().optional(),
        whatsappProvider: z.enum(['twilio', 'meta']).optional(),
        settings: z.record(z.string(), z.unknown()).optional(),
    }),
};
