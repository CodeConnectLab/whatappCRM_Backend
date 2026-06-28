import { z } from "zod";
const mediaValidation = {
  presign: z.object({
    filename: z.string().min(1),
    contentType: z.string().min(3)
  })
};
export {
  mediaValidation
};
