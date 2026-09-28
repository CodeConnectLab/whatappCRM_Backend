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
        /** Approved template — the only thing deliverable outside the 24-hour window. */
        templateId: objectId.optional(),
        /** Canned reply the text came from, for the picker's usage ordering. */
        quickReplyId: objectId.optional(),
      })
      // A message needs text, an attachment or a template — never nothing at all.
      .refine((v) => Boolean(v.body?.trim()) || Boolean(v.mediaId) || Boolean(v.templateId), {
        message: 'Provide a message body, an attachment or a template',
      })
      // A template renders its own body from the approved copy, so free-form text or a
      // separate attachment alongside it would silently be dropped.
      .refine((v) => !v.templateId || (!v.body?.trim() && !v.mediaId), {
        message: 'A template is sent on its own — clear the message box and any attachment',
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
  updateTags: {
    params: z.object({ chatId: objectId }),
    body: z.object({ tags: z.array(z.string().trim().min(1).max(40)).max(20) }),
  },
  createQuickReply: z.object({
    title: z.string().trim().min(1).max(120),
    body: z.string().min(1).max(4096),
    shortcut: z.string().trim().max(40).optional(),
    mediaId: objectId.optional(),
  }),
  updateQuickReply: {
    params: z.object({ id: objectId }),
    body: z.object({
      title: z.string().trim().min(1).max(120).optional(),
      body: z.string().min(1).max(4096).optional(),
      shortcut: z.string().trim().max(40).nullable().optional(),
      mediaId: objectId.nullable().optional(),
    }),
  },
  quickReplyById: {
    params: z.object({ id: objectId }),
  },
};
