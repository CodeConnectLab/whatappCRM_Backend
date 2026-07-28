import { MembershipModel } from '../modules/company/membership.model.js';
import { Types } from 'mongoose';
export async function resolveTenant(req, res, next) {
    if (!req.user) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    if (req.user.isSuperAdmin) {
        const raw = req.header('x-company-id');
        if (!raw || !Types.ObjectId.isValid(raw)) {
            res.status(400).json({ error: 'super_admin requires x-company-id header' });
            return;
        }
        req.companyId = raw;
        req.membershipRole = 'company_admin';
        next();
        return;
    }
    const wanted = req.header('x-company-id');
    const filter = {
        userId: new Types.ObjectId(req.user.sub),
        deletedAt: null,
    };
    if (wanted && Types.ObjectId.isValid(wanted)) {
        filter.companyId = new Types.ObjectId(wanted);
    }
    const m = await MembershipModel.findOne(filter).lean();
    if (!m) {
        res.status(403).json({ error: 'No company membership' });
        return;
    }
    req.companyId = String(m.companyId);
    req.membershipRole = m.role;
    next();
}
export function tenantMiddleware(req, res, next) {
    void resolveTenant(req, res, next).catch(next);
}
export function tenantQuery(companyId) {
    return { companyId: new Types.ObjectId(companyId) };
}
