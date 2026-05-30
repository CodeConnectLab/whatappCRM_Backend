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

export async function listTeam(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const members = await MembershipModel.find({ companyId: new Types.ObjectId(companyId), deletedAt: null })
    .populate('userId', 'email name')
    .lean();
  res.json(members);
}

export async function inviteMember(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const { email, role } = req.body as { email: string; role: 'company_admin' | 'agent' };
  const user = await UserModel.findOne({ email, deletedAt: null });
  if (!user) {
    res.status(404).json({ error: 'User must register first' });
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
