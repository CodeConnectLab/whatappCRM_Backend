import { Schema, type InferSchemaType, type Model } from 'mongoose';
import { getModel } from '../../utils/registerModel.js';

const activityLogSchema = new Schema(
  {
    companyId: { type: Schema.Types.ObjectId, ref: 'Company', index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User' },
    action: { type: String, required: true },
    resource: { type: String },
    resourceId: { type: Schema.Types.ObjectId },
    meta: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
);

activityLogSchema.index({ companyId: 1, createdAt: -1 });

export type ActivityLog = InferSchemaType<typeof activityLogSchema>;
export const ActivityLogModel: Model<ActivityLog> = getModel<ActivityLog>('ActivityLog', activityLogSchema);
