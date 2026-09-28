import { z } from 'zod';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i);
const stringList = z.array(z.string().trim().min(1).max(200)).max(50);

const base = {
  description: z.string().max(2000).optional(),
  keywords: stringList.optional(),
  adIds: stringList.optional(),
  campaignNames: stringList.optional(),
  whatsappNumberIds: z.array(objectId).max(20).optional(),
  crmLabel: z.string().max(120).optional(),
  active: z.boolean().optional(),
};

export const productValidation = {
  create: z.object({ name: z.string().trim().min(1).max(160), ...base }),
  update: {
    params: z.object({ id: objectId }),
    body: z.object({ name: z.string().trim().min(1).max(160).optional(), ...base }),
  },
  byId: { params: z.object({ id: objectId }) },
};
