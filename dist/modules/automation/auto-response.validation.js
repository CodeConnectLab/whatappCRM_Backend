import { z } from 'zod';
import { AUTO_RESPONSE_ACTIONS, AUTO_RESPONSE_THROTTLES, AUTO_RESPONSE_TRIGGERS, } from './auto-response.model.js';
const objectId = z.string().regex(/^[a-f0-9]{24}$/i);
const stringList = z.array(z.string().trim().min(1).max(200)).max(50);
const businessHours = z.object({
    timezone: z.string().min(1).max(64).optional(),
    startMinute: z.number().int().min(0).max(24 * 60),
    endMinute: z.number().int().min(0).max(24 * 60),
    weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
});
const shape = {
    enabled: z.boolean().optional(),
    priority: z.number().int().min(0).max(10_000).optional(),
    trigger: z.enum(AUTO_RESPONSE_TRIGGERS).optional(),
    // null clears the link; omitting the key leaves it alone.
    productId: objectId.nullable().optional(),
    adIds: stringList.optional(),
    campaignNames: stringList.optional(),
    whatsappNumberIds: z.array(objectId).max(20).optional(),
    keywords: stringList.optional(),
    adLeadsOnly: z.boolean().optional(),
    businessHours: businessHours.nullable().optional(),
    actionType: z.enum(AUTO_RESPONSE_ACTIONS).optional(),
    body: z.string().max(4096).optional(),
    templateId: objectId.nullable().optional(),
    mediaId: objectId.nullable().optional(),
    delaySeconds: z.number().int().min(0).max(60).optional(),
    delayMinutes: z.number().int().min(1).max(1440).optional(),
    throttle: z.enum(AUTO_RESPONSE_THROTTLES).optional(),
};
/** A rule must actually be able to send something. */
function hasAnAction(v) {
    if (v.actionType === 'template')
        return Boolean(v.templateId);
    return Boolean(v.body?.trim()) || Boolean(v.mediaId);
}
export const autoResponseValidation = {
    create: z
        .object({ name: z.string().trim().min(1).max(160), ...shape })
        .refine(hasAnAction, {
        message: 'Pick a template, or write a message body / attach a file',
    }),
    update: {
        params: z.object({ id: objectId }),
        body: z.object({ name: z.string().trim().min(1).max(160).optional(), ...shape }),
    },
    byId: { params: z.object({ id: objectId }) },
    preview: z.object({
        messageBody: z.string().max(4096).default(''),
        isFirstInbound: z.boolean().optional(),
        productId: objectId.optional(),
        adSourceId: z.string().max(120).optional(),
        adHeadline: z.string().max(400).optional(),
        whatsappNumberId: objectId.optional(),
        isAdLead: z.boolean().optional(),
    }),
};
