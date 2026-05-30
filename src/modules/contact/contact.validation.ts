import { z } from 'zod';
import { idParamSchema } from '../../middleware/validate.js';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i);

export const contactValidation = {
  createContact: z.object({
    phone: z.string().min(5),
    name: z.string().optional(),
    email: z.string().email().optional(),
    tags: z.array(z.string()).optional(),
  }),
  updateContact: { params: idParamSchema, body: z.object({}).passthrough() },
  deleteContact: { params: idParamSchema },
  createGroup: z.object({
    name: z.string().min(1),
    contactIds: z.array(objectId).default([]),
  }),
  updateGroup: {
    params: idParamSchema,
    body: z.object({
      name: z.string().optional(),
      contactIds: z.array(objectId).optional(),
    }),
  },
};
