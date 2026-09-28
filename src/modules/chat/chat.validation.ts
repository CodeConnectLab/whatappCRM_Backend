import { z } from 'zod';
import { LEAD_STATUSES } from './chat.model.js';

const objectId = z.string().regex(/^[a-f0-9]{24}$/i);

export const chatValidation = {
  messagesParams: z.object({ chatId: objectId }),
  messagesQuery: z.object({
    limit: z.coerce.number().min(1).max(100).optional(),
    before: objectId.optional(),
  }),
  listQuery: z.object({
    /** 'mine' | 'unassigned' | 'all' | a user id. Agents are pinned to their own leads. */
    assigned: z.union([z.enum(['mine', 'unassigned', 'all']), objectId]).optional(),
    status: z.union([z.enum(LEAD_STATUSES), z.literal('open')]).optional(),
    productId: objectId.optional(),
    search: z.string().max(200).optional(),
    adOnly: z.enum(['true', 'false']).optional(),
  }),
  postMessage: {
    params: z.object({ chatId: objectId }),
    body: z
      .object({
        body: z.string().max(4096).optional(),
        /** Attachment uploaded through /media/presign. */
        mediaId: objectId.optional(),
      })
      // A message needs text, an attachment, or both — never neither.
      .refine((v) => Boolean(v.body?.trim()) || Boolean(v.mediaId), {
        message: 'Provide a message body or an attachment',
      }),
  },
  createChat: {
    body: z.object({
      contactId: objectId,
      whatsappNumberId: objectId.optional(),
    }),
  },
  updateStatus: {
    params: z.object({ chatId: objectId }),
    body: z.object({ status: z.enum(LEAD_STATUSES) }),
  },
  updateAssignment: {
    params: z.object({ chatId: objectId }),
    body: z.object({ assignedTo: objectId.nullable() }),
  },
  addNote: {
    params: z.object({ chatId: objectId }),
    body: z.object({ body: z.string().min(1).max(4000) }),
  },
  noteParams: {
    params: z.object({ chatId: objectId, noteId: objectId }),
  },
};
