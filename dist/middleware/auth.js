import { verifyAccessToken } from '../utils/jwt.js';
export function requireAuth(req, res, next) {
    const header = req.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
    }
    const token = header.slice('Bearer '.length);
    try {
        const payload = verifyAccessToken(token);
        req.user = {
            sub: payload.sub,
            email: payload.email,
            isSuperAdmin: payload.isSuperAdmin,
        };
        next();
    }
    catch {
        res.status(401).json({ error: 'Invalid token' });
    }
}
