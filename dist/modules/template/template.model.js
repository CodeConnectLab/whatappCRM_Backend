import { Schema } from 'mongoose';
import { getModel } from '../../utils/registerModel.js';
/** Meta review states, plus `local` for templates never submitted to Meta. */
export const TEMPLATE_STATUSES = [
    'local',
    'PENDING',
    'APPROVED',
    'REJECTED',
    'PAUSED',
    'DISABLED',
    'IN_APPEAL',
];
export const TEMPLATE_CATEGORIES = ['MARKETING', 'UTILITY', 'AUTHENTICATION'];
const templateSchema = new Schema({
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', required: true, index: true },
    name: { type: String, required: true, trim: true },
    body: { type: String, required: true },
    /** Optional public HTTPS URL; sent as WhatsApp media when starting campaigns. */
    imageUrl: { type: String, trim: true },
    language: { type: String, default: 'en' },
    /** --- Meta Cloud API template approval --- */
    /** Meta's template id, set once submitted. Absent means never submitted. */
    metaTemplateId: { type: String, trim: true },
    /** Lowercase snake_case name Meta knows this template by (derived from `name`). */
    metaTemplateName: { type: String, trim: true },
    status: { type: String, enum: TEMPLATE_STATUSES, default: 'local' },
    category: { type: String, enum: TEMPLATE_CATEGORIES, default: 'UTILITY' },
    /**
     * Named placeholders in `body`, in the order Meta sees them as {{1}}, {{2}}, ...
     * e.g. ['name', 'phone'] means {{1}} is the contact name and {{2}} the phone.
     */
    variables: { type: [String], default: [] },
    /** Meta's reason when status is REJECTED. */
    rejectedReason: { type: String, trim: true },
    submittedAt: { type: Date },
    syncedAt: { type: Date },
    deletedAt: { type: Date },
}, { timestamps: true });
templateSchema.index({ companyId: 1, name: 1 }, { unique: true, partialFilterExpression: { deletedAt: null } });
export const TemplateModel = getModel('Template', templateSchema);
