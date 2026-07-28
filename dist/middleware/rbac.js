export function requireSuperAdmin(req, res, next) {
    if (!req.user?.isSuperAdmin) {
        res.status(403).json({ error: 'Super admin only' });
        return;
    }
    next();
}
export function requireCompanyAdmin(req, res, next) {
    if (req.user?.isSuperAdmin) {
        next();
        return;
    }
    if (req.membershipRole === 'company_admin') {
        next();
        return;
    }
    res.status(403).json({ error: 'Company admin required' });
}
export function requireAgent(req, res, next) {
    if (req.membershipRole === 'company_admin' || req.membershipRole === 'agent') {
        next();
        return;
    }
    res.status(403).json({ error: 'Agent access required' });
}
