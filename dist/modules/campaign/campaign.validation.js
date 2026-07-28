import { z } from 'zod';
import { idParamSchema } from '../../middleware/validate.js';
const objectId = z.string().regex(/^[a-f0-9]{24}$/i);
export const campaignValidation = {
    create: z.object({
        name: z.string().min(1),
        templateId: objectId,
        whatsappNumberId: objectId,
        contactGroupIds: z.array(objectId).optional(),
        contactIds: z.array(objectId).optional(),
        scheduledAt: z.string().optional(),
    }),
    update: { params: idParamSchema, body: z.object({}).passthrough() },
    byId: { params: idParamSchema },
};
