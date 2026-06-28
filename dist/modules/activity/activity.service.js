import { Types } from "mongoose";
import { ActivityLogModel } from "./activity-log.model.js";
async function logActivity(input) {
  await ActivityLogModel.create({
    companyId: input.companyId ? new Types.ObjectId(input.companyId) : void 0,
    userId: input.userId ? new Types.ObjectId(input.userId) : void 0,
    action: input.action,
    resource: input.resource,
    resourceId: input.resourceId ? new Types.ObjectId(input.resourceId) : void 0,
    meta: input.meta
  });
}
export {
  logActivity
};
