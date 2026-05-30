import { Types } from 'mongoose';
import { ActivityLogModel } from './activity-log.model.js';

export async function logActivity(input: {
  companyId?: string | null;
  userId?: string | null;
  action: string;
  resource?: string;
  resourceId?: string | null;
  meta?: unknown;
}): Promise<void> {
  await ActivityLogModel.create({
    companyId: input.companyId ? new Types.ObjectId(input.companyId) : undefined,
    userId: input.userId ? new Types.ObjectId(input.userId) : undefined,
    action: input.action,
    resource: input.resource,
    resourceId: input.resourceId ? new Types.ObjectId(input.resourceId) : undefined,
    meta: input.meta,
  });
}
