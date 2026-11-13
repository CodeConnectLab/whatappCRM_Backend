import { Types } from 'mongoose';
import { CompanyModel } from '../company/company.model.js';
import { MembershipModel } from '../company/membership.model.js';
import { DEFAULT_USER_LIMIT, EXPIRING_SOON_DAYS, SUBSCRIPTION_ERROR, SUBSCRIPTION_EXPIRED_MESSAGE, } from './subscription.constants.js';
const MS_PER_DAY = 24 * 60 * 60 * 1000;
export class SubscriptionError extends Error {
    code = SUBSCRIPTION_ERROR.SUBSCRIPTION_EXPIRED;
    status = 403;
    constructor(message = SUBSCRIPTION_EXPIRED_MESSAGE) {
        super(message);
    }
}
/**
 * The calendar date is what decides, so no cron is needed to flip stale rows. A missing
 * `endDate` counts as expired — a company row with no term must not grant access.
 * `status: 'expired'` stays available as a manual kill switch with a future end date.
 */
export function isExpired(company) {
    const sub = company?.subscription;
    if (!sub?.endDate)
        return true;
    if (sub.status === 'expired')
        return true;
    return new Date(sub.endDate).getTime() <= Date.now();
}
export function resolveUserLimit(company) {
    const raw = company?.subscription?.userLimit;
    if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 1)
        return raw;
    return DEFAULT_USER_LIMIT;
}
export function computeState(company) {
    if (isExpired(company))
        return { kind: 'expired', daysRemaining: 0 };
    const endDate = company?.subscription?.endDate;
    const daysRemaining = Math.ceil((new Date(endDate).getTime() - Date.now()) / MS_PER_DAY);
    if (daysRemaining <= EXPIRING_SOON_DAYS)
        return { kind: 'expiring_soon', daysRemaining };
    return { kind: 'active', daysRemaining };
}
export async function getCompanySubscriptionLean(companyId) {
    if (!Types.ObjectId.isValid(companyId))
        return null;
    return CompanyModel.findOne({ _id: new Types.ObjectId(companyId), deletedAt: null })
        .select('name subscription')
        .lean();
}
/**
 * Seats are memberships, not users: a single login can belong to several companies, so
 * counting users would charge one company for another's people.
 */
export async function countSeats(companyId) {
    if (!Types.ObjectId.isValid(companyId))
        return 0;
    return MembershipModel.countDocuments({
        companyId: new Types.ObjectId(companyId),
        deletedAt: null,
    });
}
export async function verifyActiveForRequest(companyId) {
    const company = await getCompanySubscriptionLean(companyId);
    // A missing or soft-deleted company is treated the same as an expired one.
    if (!company || isExpired(company))
        throw new SubscriptionError();
}
/** True when at least one of the user's workspaces is still in good standing. */
export async function hasAnyActiveCompany(userId) {
    if (!Types.ObjectId.isValid(userId))
        return false;
    const memberships = await MembershipModel.find({
        userId: new Types.ObjectId(userId),
        deletedAt: null,
    })
        .select('companyId')
        .lean();
    if (memberships.length === 0)
        return false;
    const companies = await CompanyModel.find({
        _id: { $in: memberships.map((m) => m.companyId) },
        deletedAt: null,
    })
        .select('subscription')
        .lean();
    return companies.some((c) => !isExpired(c));
}
/** The one payload both the expired wall and Settings → Subscription render. */
export async function getSubscriptionSnapshot(companyId) {
    const company = await getCompanySubscriptionLean(companyId);
    if (!company)
        return null;
    const state = computeState(company);
    return {
        companyId: String(company._id),
        companyName: company.name,
        subscription: company.subscription ?? null,
        usersUsed: await countSeats(companyId),
        userLimit: resolveUserLimit(company),
        kind: state.kind,
        daysRemaining: state.daysRemaining,
        isExpired: state.kind === 'expired',
        isExpiringSoon: state.kind === 'expiring_soon',
    };
}
/** Trimmed shape for `/me`, where one response carries every membership's state. */
export function subscriptionSummary(company) {
    const sub = company?.subscription ?? null;
    const state = computeState(company ?? null);
    return {
        plan: sub?.plan ?? 'free',
        status: sub?.status ?? 'expired',
        endDate: sub?.endDate ? new Date(sub.endDate).toISOString() : null,
        userLimit: resolveUserLimit(company ?? null),
        kind: state.kind,
        daysRemaining: state.daysRemaining,
        isExpired: state.kind === 'expired',
        isExpiringSoon: state.kind === 'expiring_soon',
    };
}
