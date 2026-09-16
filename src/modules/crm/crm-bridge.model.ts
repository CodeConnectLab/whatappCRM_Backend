import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { getModel } from '../../utils/registerModel.js';

export const CRM_PUSH_MODES = ['ad_only', 'all_inbound'] as const;

/**
 * Per-workspace bridge to the client's own CRM.
 *
 * WTSP is the WhatsApp gateway; the CRM stays the system of record for leads. One
 * config per company, holding the CRM's API key encrypted at rest the same way the
 * Meta credentials are.
 */
const crmBridgeSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      unique: true,
      index: true,
    },
    enabled: { type: Boolean, default: false },
    /** CRM API origin including the version prefix, e.g. https://api.codeconnect.in/api/v1 */
    crmBaseUrl: { type: String, trim: true },
    /** Value of the `apikey` query param the CRM's outsource-lead endpoint expects. */
    crmApiKeyEncrypted: { type: String },
    /**
     * ad_only  — push only conversations carrying a ctwa_clid (paid ad leads).
     * all_inbound — push every new WhatsApp conversation as a lead.
     */
    pushMode: { type: String, enum: CRM_PUSH_MODES, default: 'ad_only' },
    /** Optional label stored on the lead so the CRM can tell workspaces apart. */
    leadSourceLabel: { type: String, trim: true },
    /** Book-keeping so the Settings screen can show whether the bridge is actually working. */
    lastPushAt: { type: Date },
    lastPushStatus: { type: String, trim: true },
    lastPushError: { type: String, trim: true },
    totalPushed: { type: Number, default: 0 },
    totalFailed: { type: Number, default: 0 },
    deletedAt: { type: Date },
  },
  { timestamps: true },
);

export type CrmBridge = InferSchemaType<typeof crmBridgeSchema>;
export const CrmBridgeModel: Model<CrmBridge> = getModel<CrmBridge>('CrmBridge', crmBridgeSchema);
