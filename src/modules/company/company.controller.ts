import type { Request, Response } from 'express';
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
import {
  TeamError,
  createTeamUser,
  listTeamMembers,
  removeTeamMember,
  resetTeamMemberPassword,
  updateTeamMember,
} from './team.service.js';
import type { MembershipRole } from './membership.model.js';

export async function listCompanies(req: Request, res: Response): Promise<void> {
  const opts = parsePagination(req.query as Record<string, unknown>);
  const filter = { deletedAt: null };
  const result = await paginate(CompanyModel, filter, opts);
  res.json(result);
}

export async function createCompanyAdmin(req: Request, res: Response): Promise<void> {
  const { name } = req.body as { name: string };
  const c = await CompanyModel.create({ name, slug: slugify(name) });
  await ensureWallet(String(c._id));
  res.status(201).json(c);
}

export async function creditCompanyWallet(req: Request, res: Response): Promise<void> {
  const { companyId, amount, reason } = req.body as {
    companyId: string;
    amount: number;
    reason: string;
  };
  await creditCredits(companyId, amount, reason ?? 'admin_adjustment', { by: req.user?.sub });
  res.json({ ok: true });
}

export async function promoteSuperAdmin(req: Request, res: Response): Promise<void> {
  const { userId, isSuperAdmin } = req.body as { userId: string; isSuperAdmin: boolean };
  await UserModel.updateOne({ _id: new Types.ObjectId(userId) }, { $set: { isSuperAdmin } });
  res.json({ ok: true });
}

function failTeam(res: Response, e: unknown, fallback: string): void {
  const status = e instanceof TeamError ? e.status : 400;
  res.status(status).json({ error: e instanceof Error ? e.message : fallback });
}

export async function listTeam(req: Request, res: Response): Promise<void> {
  res.json(await listTeamMembers(req.companyId!));
}

/**
 * Creates the login and the membership together.
 *
 * This replaces the old "the user must register first" flow: an admin adds people the
 * same way they would in the CRM, typing a starting password that they hand over. The
 * account is flagged so the person is asked to choose their own on first login.
 */
export async function createUser(req: Request, res: Response): Promise<void> {
  const body = req.body as {
    name: string;
    email: string;
    password: string;
    role: MembershipRole;
    availableForLeads?: boolean;
  };
  try {
    const result = await createTeamUser({
      companyId: req.companyId!,
      actorUserId: req.user!.sub,
      ...body,
    });
    res.status(201).json(result);
  } catch (e) {
    failTeam(res, e, 'Could not create user');
  }
}

export async function patchMember(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const body = req.body as { role?: MembershipRole; availableForLeads?: boolean };
  try {
    res.json(
      await updateTeamMember({
        companyId: req.companyId!,
        actorUserId: req.user!.sub,
        membershipId: id,
        ...body,
      }),
    );
  } catch (e) {
    failTeam(res, e, 'Could not update member');
  }
}

export async function deleteMember(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  try {
    await removeTeamMember({
      companyId: req.companyId!,
      actorUserId: req.user!.sub,
      membershipId: id,
    });
    res.json({ ok: true });
  } catch (e) {
    failTeam(res, e, 'Could not remove member');
  }
}

export async function resetMemberPassword(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const { password } = req.body as { password: string };
  try {
    await resetTeamMemberPassword({
      companyId: req.companyId!,
      actorUserId: req.user!.sub,
      membershipId: id,
      password,
    });
    res.json({ ok: true });
  } catch (e) {
    failTeam(res, e, 'Could not reset password');
  }
}

/**
 * Kept for compatibility with the old Team screen: attaching an already-registered
 * user. New callers should use createUser, which does not require prior registration.
 */
export async function inviteMember(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const { email, role } = req.body as { email: string; role: MembershipRole };
  const user = await UserModel.findOne({ email: email.trim().toLowerCase(), deletedAt: null });
  if (!user) {
    res.status(404).json({
      error: 'No account with that email — use “Add user” to create one directly',
    });
    return;
  }
  await MembershipModel.findOneAndUpdate(
    { userId: user._id, companyId: new Types.ObjectId(companyId) },
    {
      $set: {
        role,
        deletedAt: null,
        userId: user._id,
        companyId: new Types.ObjectId(companyId),
      },
    },
    { upsert: true, new: true },
  );
  res.status(201).json({ ok: true });
}

export async function getWorkspaceSummary(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const oid = new Types.ObjectId(companyId);

  const [company, metaCfg, metaReadiness, chatCount, templateCount] = await Promise.all([
    CompanyModel.findById(oid).lean(),
    MetaWhatsappConfigModel.findOne({ companyId: oid, deletedAt: null }).lean(),
    getMetaReadiness(companyId),
    ChatModel.countDocuments({ companyId: oid, deletedAt: null }),
    TemplateModel.countDocuments({ companyId: oid, deletedAt: null }),
  ]);

  res.json({
    whatsappProvider: (company?.whatsappProvider as 'twilio' | 'meta' | undefined) ?? 'twilio',
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
