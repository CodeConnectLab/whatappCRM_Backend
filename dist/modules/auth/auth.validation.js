import { z } from "zod";
const authValidation = {
  register: z.object({
    email: z.string().email(),
    password: z.string().min(8),
    name: z.string().min(1),
    companyName: z.string().min(1)
  }),
  login: z.object({
    email: z.string().email(),
    password: z.string().min(1)
  }),
  refresh: z.object({ refreshToken: z.string().min(10) }),
  forgotPassword: z.object({ email: z.string().email() }),
  resetPassword: z.object({
    token: z.string().min(10),
    password: z.string().min(8)
  })
};
export {
  authValidation
};
