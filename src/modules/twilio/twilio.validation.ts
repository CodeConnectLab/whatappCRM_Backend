import { z } from 'zod';
import { e164PhoneSchema } from '../../utils/phone.js';

export const twilioValidation = {
  upsertAccount: z.object({
    accountSid: z.string().min(10),
    authToken: z.string().min(10),
    friendlyName: z.string().optional(),
  }),
  upsertNumber: z
    .object({
      provider: z.enum(['twilio', 'meta']).optional().default('twilio'),
      twilioAccountId: z
        .string()
        .regex(/^[a-f0-9]{24}$/i)
        .optional(),
      metaPhoneNumberId: z.string().min(4).optional(),
      phoneNumber: e164PhoneSchema,
      friendlyName: z.string().optional(),
      isDefault: z.boolean().optional(),
    })
    .superRefine((data, ctx) => {
      const p = data.provider ?? 'twilio';
      if (p === 'twilio' && !data.twilioAccountId) {
        ctx.addIssue({
          code: 'custom',
          message: 'twilioAccountId required for Twilio senders',
          path: ['twilioAccountId'],
        });
      }
      if (p === 'meta' && !data.metaPhoneNumberId?.trim()) {
        ctx.addIssue({
          code: 'custom',
          message: 'metaPhoneNumberId required for Meta (Cloud API) senders',
          path: ['metaPhoneNumberId'],
        });
      }
    }),
};
