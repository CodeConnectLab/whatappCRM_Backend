import bcrypt from 'bcrypt';
import { randomBytes, createHash } from 'crypto';
import { CompanyModel } from '../company/company.model.js';
import { MembershipModel } from '../company/membership.model.js';
import { UserModel } from '../user/user.model.js';
import { env } from '../../config/env.js';
import { signAccessToken, signRefreshToken, verifyRefreshToken } from '../../utils/jwt.js';
import { slugify } from '../../utils/slug.js';
import { ensureWallet } from '../wallet/wallet.service.js';
import { logActivity } from '../activity/activity.service.js';
import { logger } from '../../utils/logger.js';
import { hasAnyActiveCompany } from '../subscription/subscription.service.js';
import { SUBSCRIPTION_ERROR, SUBSCRIPTION_EXPIRED_MESSAGE, } from '../subscription/subscription.constants.js';
export async function register(req, res) {
    const { email, password, name, companyName } = req.body;
    const exists = await UserModel.findOne({ email, deletedAt: null });
    if (exists) {
        res.status(409).json({ error: 'Email already registered' });
        return;
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const company = await CompanyModel.create({
        name: companyName,
        slug: slugify(companyName),
    });
    const user = await UserModel.create({
        email,
        passwordHash,
        name,
    });
    await MembershipModel.create({
        userId: user._id,
        companyId: company._id,
        role: 'company_admin',
    });
    await ensureWallet(String(company._id));
    await logActivity({
        companyId: String(company._id),
        userId: String(user._id),
        action: 'company.registered',
        resource: 'company',
        resourceId: String(company._id),
    });
    const tokenPayload = {
        sub: String(user._id),
        email: user.email,
        isSuperAdmin: user.isSuperAdmin,
        tv: user.tokenVersion ?? 0,
    };
    res.status(201).json({
        accessToken: signAccessToken(tokenPayload),
        refreshToken: signRefreshToken(tokenPayload),
        user: { id: user._id, email: user.email, name: user.name, isSuperAdmin: Boolean(user.isSuperAdmin) },
        company: { id: company._id, name: company.name, slug: company.slug },
    });
}
export async function login(req, res) {
    const { email, password } = req.body;
    const user = await UserModel.findOne({ email, deletedAt: null });
    if (!user) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
    }
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
        res.status(401).json({ error: 'Invalid credentials' });
        return;
    }
    /**
     * An expired workspace still signs in. The client needs a token to read `/me` and
     * `/subscription` so the expired screen can name the plan and the support contact;
     * every other route is refused by `subscriptionGuard`.
     */
    const tokenPayload = {
        sub: String(user._id),
        email: user.email,
        isSuperAdmin: user.isSuperAdmin,
        tv: user.tokenVersion ?? 0,
    };
    res.json({
        accessToken: signAccessToken(tokenPayload),
        refreshToken: signRefreshToken(tokenPayload),
        user: { id: user._id, email: user.email, name: user.name, isSuperAdmin: user.isSuperAdmin },
    });
}
export async function refresh(req, res) {
    const { refreshToken } = req.body;
    try {
        const payload = verifyRefreshToken(refreshToken);
        const user = await UserModel.findById(payload.sub);
        if (!user || user.deletedAt) {
            res.status(401).json({ error: 'Unauthorized' });
            return;
        }
        if ((user.tokenVersion ?? 0) !== (payload.tv ?? 0)) {
            res.status(401).json({ error: 'Session ended, please sign in again' });
            return;
        }
        /**
         * Refusing renewal is what makes expiry bite: the live access token dies at its own
         * TTL instead of being rolled forward indefinitely. Super admins are exempt, and so
         * is anyone who still has at least one workspace in good standing.
         */
        if (!user.isSuperAdmin && !(await hasAnyActiveCompany(String(user._id)))) {
            res.status(401).json({
                error: SUBSCRIPTION_EXPIRED_MESSAGE,
                code: SUBSCRIPTION_ERROR.SUBSCRIPTION_EXPIRED,
            });
            return;
        }
        const next = {
            sub: String(user._id),
            email: user.email,
            isSuperAdmin: user.isSuperAdmin,
            tv: user.tokenVersion ?? 0,
        };
        res.json({
            accessToken: signAccessToken(next),
            refreshToken: signRefreshToken(next),
        });
    }
    catch {
        res.status(401).json({ error: 'Invalid refresh token' });
    }
}
/**
 * Lets a signed-in user replace their own password — the exit from the
 * `mustChangePassword` state an admin-created account starts in.
 */
export async function changePassword(req, res) {
    const { currentPassword, password } = req.body;
    const user = await UserModel.findOne({ _id: req.user.sub, deletedAt: null });
    if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
    }
    const ok = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!ok) {
        res.status(400).json({ error: 'Current password is incorrect' });
        return;
    }
    user.passwordHash = await bcrypt.hash(password, 12);
    user.mustChangePassword = false;
    await user.save();
    res.json({ ok: true });
}
export async function forgotPassword(req, res) {
    const { email } = req.body;
    const user = await UserModel.findOne({ email, deletedAt: null });
    if (!user) {
        res.json({ ok: true });
        return;
    }
    const raw = randomBytes(32).toString('hex');
    const passwordResetTokenHash = createHash('sha256').update(raw).digest('hex');
    user.passwordResetTokenHash = passwordResetTokenHash;
    user.passwordResetExpires = new Date(Date.now() + 1000 * 60 * 60);
    await user.save();
    const link = `${env.FRONTEND_URL}/reset-password?token=${raw}`;
    if (env.SMTP_URL) {
        logger.info('Password reset email (SMTP not wired)', { to: email, link });
    }
    else {
        logger.info('Password reset link', { to: email, link });
    }
    res.json({ ok: true });
}
export async function resetPassword(req, res) {
    const { token, password } = req.body;
    const hash = createHash('sha256').update(token).digest('hex');
    const user = await UserModel.findOne({
        passwordResetTokenHash: hash,
        passwordResetExpires: { $gt: new Date() },
        deletedAt: null,
    });
    if (!user) {
        res.status(400).json({ error: 'Invalid or expired token' });
        return;
    }
    user.passwordHash = await bcrypt.hash(password, 12);
    user.passwordResetTokenHash = undefined;
    user.passwordResetExpires = undefined;
    await user.save();
    res.json({ ok: true });
}
