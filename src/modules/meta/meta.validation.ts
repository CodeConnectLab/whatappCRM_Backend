import { z } from 'zod';

const optionalTrimmed = z.preprocess((v) => {
  if (v == null || typeof v !== 'string') return undefined;
  const t = v.trim();
  return t.length ? t : undefined;
}, z.string().optional());

export const metaValidation = {
  upsertConfig: z
    .object({
      accessToken: z.preprocess(
        (v) => (typeof v === 'string' ? v.trim() : v),
        z.string().min(20, 'Access token looks too short').optional(),
      ),
      appSecret: z.preprocess(
        (v) => (typeof v === 'string' ? v.trim() : v),
        z.string().min(8, 'App secret looks too short').optional(),
      ),
      wabaId: optionalTrimmed,
      appId: optionalTrimmed,
      webhookVerifyToken: z.preprocess(
        (v) => (typeof v === 'string' ? v.trim() : v),
        z.string().min(8).max(256).optional(),
      ),
      regenerateWebhookVerifyToken: z.boolean().optional(),
    })
    .refine(
      (data) =>
        Boolean(
          data.accessToken ||
            data.appSecret ||
            data.wabaId !== undefined ||
            data.appId !== undefined ||
            data.webhookVerifyToken ||
            data.regenerateWebhookVerifyToken,
        ),
      { message: 'Provide at least one field to update' },
    ),
};
