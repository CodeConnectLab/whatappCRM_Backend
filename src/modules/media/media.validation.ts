import { z } from 'zod';

export const mediaValidation = {
  presign: z.object({
    filename: z.string().min(1),
    contentType: z.string().min(3),
  }),
};
