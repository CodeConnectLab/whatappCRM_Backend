import { z } from 'zod';

const optionalTrimmed = z.preprocess((v) => {
  if (v == null || typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}, z.string().optional());

export const crmBridgeValidation = {
  upsert: z
    .object({
      enabled: z.boolean().optional(),
      /**
       * Full API origin including the version prefix, e.g.
       * https://api.codeconnect.in/api/v1 — "/outsource-lead" is appended to it.
       */
      crmBaseUrl: z.preprocess(
        (v) => (typeof v === 'string' ? v.trim().replace(/\/$/, '') : v),
        z.string().url('CRM base URL must be a valid https URL').optional(),
      ),
      crmApiKey: z.preprocess(
        (v) => (typeof v === 'string' ? v.trim() : v),
        z.string().min(8, 'API key looks too short').optional(),
      ),
      pushMode: z.enum(['ad_only', 'all_inbound']).optional(),
      leadSourceLabel: optionalTrimmed,
    })
    .refine(
      (d) =>
        d.enabled !== undefined ||
        d.crmBaseUrl !== undefined ||
        d.crmApiKey !== undefined ||
        d.pushMode !== undefined ||
        d.leadSourceLabel !== undefined,
      { message: 'Provide at least one field to update' },
    ),
};
