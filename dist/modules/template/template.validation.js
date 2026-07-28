import { z } from 'zod';
import { idParamSchema } from '../../middleware/validate.js';
import { TEMPLATE_CATEGORIES } from './template.model.js';
export const templateValidation = {
    create: z.object({
        name: z.string().min(1),
        body: z.string().min(1),
        language: z.string().optional(),
        category: z.enum(TEMPLATE_CATEGORIES).optional(),
        imageUrl: z.preprocess((val) => (val === '' || val === null || val === undefined ? undefined : val), z.string().url().max(2048).optional()),
    }),
    update: { params: idParamSchema, body: z.object({}).passthrough() },
    delete: { params: idParamSchema },
    submit: { params: idParamSchema },
};
