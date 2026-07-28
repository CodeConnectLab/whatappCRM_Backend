import { z } from 'zod';
const objectId = z.string().regex(/^[a-f0-9]{24}$/i);
export const chatValidation = {
    messagesParams: z.object({ chatId: objectId }),
    messagesQuery: z.object({
        limit: z.coerce.number().min(1).max(100).optional(),
        before: objectId.optional(),
    }),
    postMessage: {
        params: z.object({ chatId: objectId }),
        body: z.object({ body: z.string().min(1) }),
    },
    createChat: {
        body: z.object({
            contactId: objectId,
            whatsappNumberId: objectId.optional(),
        }),
    },
};
