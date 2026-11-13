import { Types } from 'mongoose';
import { MembershipModel } from '../company/membership.model.js';
import { UserModel } from './user.model.js';
import { CompanyModel } from '../company/company.model.js';
import { subscriptionSummary } from '../subscription/subscription.service.js';

export async function getMeProfile(userId: string) {
  const userDoc = await UserModel.findById(userId).lean();
  if (!userDoc) return null;

  const user = {
    id: String(userDoc._id),
    email: userDoc.email,
    name: userDoc.name,
    isSuperAdmin: Boolean(userDoc.isSuperAdmin),
    // Drives the "pick your own password" prompt for admin-created accounts.
    mustChangePassword: Boolean(userDoc.mustChangePassword),
  };

  const membershipsRaw = await MembershipModel.find({
    userId: new Types.ObjectId(userId),
    deletedAt: null,
  }).lean();

  const companyDocs = await CompanyModel.find({
    _id: { $in: membershipsRaw.map((m) => m.companyId) },
    deletedAt: null,
  }).lean();
  const byId = new Map(companyDocs.map((c) => [String(c._id), c]));

  /**
   * Each membership carries its own subscription state: `/me` sits outside the tenant
   * router, so the client can tell on first paint whether to show the expired wall
   * without a second request that the guard would reject anyway.
   */
  const memberships = membershipsRaw.map((m) => {
    const company = byId.get(String(m.companyId));
    return {
      companyId: String(m.companyId),
      companyName: company?.name ?? '',
      role: m.role as 'company_admin' | 'agent',
      subscription: subscriptionSummary(company),
    };
  });

  return {
    user,
    memberships,
    companies: companyDocs.map((c) => ({ id: String(c._id), name: c.name, slug: c.slug })),
  };
}
