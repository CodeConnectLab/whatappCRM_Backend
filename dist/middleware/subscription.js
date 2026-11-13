import { SUBSCRIPTION_ERROR, SUBSCRIPTION_EXPIRED_MESSAGE, } from '../modules/subscription/subscription.constants.js';
import { isExpired, getCompanySubscriptionLean } from '../modules/subscription/subscription.service.js';
async function checkSubscription(req, res, next) {
    // Super admins run support on expired tenants; locking them out would leave no way back in.
    if (req.user?.isSuperAdmin) {
        next();
        return;
    }
    if (!req.companyId) {
        next();
        return;
    }
    const company = await getCompanySubscriptionLean(req.companyId);
    if (company && !isExpired(company)) {
        next();
        return;
    }
    res.status(403).json({
        error: SUBSCRIPTION_EXPIRED_MESSAGE,
        code: SUBSCRIPTION_ERROR.SUBSCRIPTION_EXPIRED,
    });
}
export function subscriptionGuard(req, res, next) {
    void checkSubscription(req, res, next).catch(next);
}
