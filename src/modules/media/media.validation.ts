import { z } from 'zod';

export const mediaValidation = {
  presign: z.object({
    filename: z.string().min(1).max(255),
    contentType: z.string().min(3).max(128),
    /** Known up front in the browser; lets the size check run before the upload. */
    size: z.number().int().positive().max(100 * 1024 * 1024).optional(),
  }),
  complete: {
    params: z.object({ id: z.string().regex(/^[a-f0-9]{24}$/i) }),
    body: z.object({ size: z.number().int().positive().max(100 * 1024 * 1024) }),
  },
  byId: { params: z.object({ id: z.string().regex(/^[a-f0-9]{24}$/i) }) },
};
