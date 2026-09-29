import { Types } from 'mongoose';
import { CompanyModel } from './company.model.js';
import { MembershipModel } from './membership.model.js';
import { UserModel } from '../user/user.model.js';
import { MetaWhatsappConfigModel } from '../meta/meta-whatsapp-config.model.js';
import { getMetaReadiness } from '../meta/whatsapp-readiness.service.js';
import { ChatModel } from '../chat/chat.model.js';
import { TemplateModel } from '../template/template.model.js';
import { parsePagination, paginate } from '../../utils/pagination.js';
import { slugify } from '../../utils/slug.js';
import { ensureWallet, creditCredits } from '../wallet/wallet.service.js';
import { TeamError, createTeamUser, listTeamMembers, removeTeamMember, resetTeamMemberPassword, updateTeamMember, } from './team.service.js';
export async function listCompanies(req, res) {
    const opts = parsePagination(req.query);
    const filter = { deletedAt: null };
    const result = await paginate(CompanyModel, filter, opts);
    res.json(result);
}
export async function createCompanyAdmin(req, res) {
    const { name } = req.body;
    const c = await CompanyModel.create({ name, slug: slugify(name) });
    await ensureWallet(String(c._id));
    res.status(201).json(c);
}
export async function creditCompanyWallet(req, res) {
    const { companyId, amount, reason } = req.body;
    await creditCredits(companyId, amount, reason ?? 'admin_adjustment', { by: req.user?.sub });
    res.json({ ok: true });
}
export async function promoteSuperAdmin(req, res) {
    const { userId, isSuperAdmin } = req.body;
    await UserModel.updateOne({ _id: new Types.ObjectId(userId) }, { $set: { isSuperAdmin } });
    res.json({ ok: true });
}
function failTeam(res, e, fallback) {
    const status = e instanceof TeamError ? e.status : 400;
    res.status(status).json({ error: e instanceof Error ? e.message : fallback });
}
export async function listTeam(req, res) {
    res.json(await listTeamMembers(req.companyId));
}
/**
 * Creates the login and the membership together.
 *
 * This replaces the old "the user must register first" flow: an admin adds people the
 * same way they would in the CRM, typing a starting password that they hand over. The
 * account is flagged so the person is asked to choose their own on first login.
 */
export async function createUser(req, res) {
    const body = req.body;
    try {
        const result = await createTeamUser({
            companyId: req.companyId,
            actorUserId: req.user.sub,
            ...body,
        });
        res.status(201).json(result);
    }
    catch (e) {
        failTeam(res, e, 'Could not create user');
    }
}
export async function patchMember(req, res) {
    const { id } = req.params;
    const body = req.body;
    try {
        res.json(await updateTeamMember({
            companyId: req.companyId,
            actorUserId: req.user.sub,
            membershipId: id,
            ...body,
        }));
    }
    catch (e) {
        failTeam(res, e, 'Could not update member');
    }
}
export async function deleteMember(req, res) {
    const { id } = req.params;
    try {
        await removeTeamMember({
            companyId: req.companyId,
            actorUserId: req.user.sub,
            membershipId: id,
        });
        res.json({ ok: true });
    }
    catch (e) {
        failTeam(res, e, 'Could not remove member');
    }
}
export async function resetMemberPassword(req, res) {
    const { id } = req.params;
    const { password } = req.body;
    try {
        await resetTeamMemberPassword({
            companyId: req.companyId,
            actorUserId: req.user.sub,
            membershipId: id,
            password,
        });
        res.json({ ok: true });
    }
    catch (e) {
        failTeam(res, e, 'Could not reset password');
    }
}
/**
 * Kept for compatibility with the old Team screen: attaching an already-registered
 * user. New callers should use createUser, which does not require prior registration.
 */
export async function inviteMember(req, res) {
    const companyId = req.companyId;
    const { email, role } = req.body;
    const user = await UserModel.findOne({ email: email.trim().toLowerCase(), deletedAt: null });
    if (!user) {
        res.status(404).json({
            error: 'No account with that email — use “Add user” to create one directly',
        });
        return;
    }
    await MembershipModel.findOneAndUpdate({ userId: user._id, companyId: new Types.ObjectId(companyId) }, {
        $set: {
            role,
            deletedAt: null,
            userId: user._id,
            companyId: new Types.ObjectId(companyId),
        },
    }, { upsert: true, new: true });
    res.status(201).json({ ok: true });
}
export async function getWorkspaceSummary(req, res) {
    const companyId = req.companyId;
    const oid = new Types.ObjectId(companyId);
    const [company, metaCfg, metaReadiness, chatCount, templateCount] = await Promise.all([
        CompanyModel.findById(oid).lean(),
        MetaWhatsappConfigModel.findOne({ companyId: oid, deletedAt: null }).lean(),
        getMetaReadiness(companyId),
        ChatModel.countDocuments({ companyId: oid, deletedAt: null }),
        TemplateModel.countDocuments({ companyId: oid, deletedAt: null }),
    ]);
    res.json({
        whatsappProvider: company?.whatsappProvider ?? 'twilio',
        metaCredentialsConfigured: metaReadiness.credentialsConfigured,
        metaSenderConfigured: metaReadiness.senderConfigured,
        metaWebhookVerified: metaReadiness.webhookVerified,
        metaReadyForCampaigns: metaReadiness.readyForOutbound && metaReadiness.webhookVerified,
        defaultWhatsappNumberId: metaReadiness.defaultSenderId,
        metaSetupIssues: metaReadiness.issues,
        wabaId: metaCfg?.wabaId,
        chatCount,
        templateCount,
    });
}
