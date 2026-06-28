import { Types } from "mongoose";
import { MembershipModel } from "../company/membership.model.js";
import { UserModel } from "./user.model.js";
import { CompanyModel } from "../company/company.model.js";
async function getMeProfile(userId) {
  const userDoc = await UserModel.findById(userId).lean();
  if (!userDoc) return null;
  const user = {
    id: String(userDoc._id),
    email: userDoc.email,
    name: userDoc.name,
    isSuperAdmin: Boolean(userDoc.isSuperAdmin)
  };
  const membershipsRaw = await MembershipModel.find({
    userId: new Types.ObjectId(userId),
    deletedAt: null
  }).lean();
  const companyDocs = await CompanyModel.find({
    _id: { $in: membershipsRaw.map((m) => m.companyId) },
    deletedAt: null
  }).lean();
  const names = new Map(companyDocs.map((c) => [String(c._id), c.name]));
  const memberships = membershipsRaw.map((m) => ({
    companyId: String(m.companyId),
    companyName: names.get(String(m.companyId)) ?? "",
    role: m.role
  }));
  return {
    user,
    memberships,
    companies: companyDocs.map((c) => ({ id: String(c._id), name: c.name, slug: c.slug }))
  };
}
export {
  getMeProfile
};
