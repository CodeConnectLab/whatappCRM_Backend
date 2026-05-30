import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { CampaignModel } from './campaign.model.js';
import { WhatsappNumberModel } from '../twilio/whatsapp-number.model.js';
import { parsePagination, paginate } from '../../utils/pagination.js';
import { enqueueCampaign, pauseCampaign, resumeCampaign } from './campaign.service.js';

async function assertWhatsappNumberForCompany(
  companyId: string,
  whatsappNumberId: string,
): Promise<void> {
  const wa = await WhatsappNumberModel.findOne({
    _id: new Types.ObjectId(whatsappNumberId),
    companyId: new Types.ObjectId(companyId),
    deletedAt: null,
  }).lean();
  if (!wa) throw new Error('WhatsApp sender not found for this workspace');
}

export async function listCampaigns(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const opts = parsePagination(req.query as Record<string, unknown>);
  const filter = { companyId: new Types.ObjectId(companyId), deletedAt: null };
  const result = await paginate(CampaignModel, filter, opts);
  res.json(result);
}

export async function createCampaign(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const body = req.body as {
    name: string;
    templateId?: string;
    whatsappNumberId: string;
    contactGroupIds?: string[];
    contactIds?: string[];
    scheduledAt?: string;
  };
  try {
    await assertWhatsappNumberForCompany(companyId, body.whatsappNumberId);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Invalid sender' });
    return;
  }
  const c = await CampaignModel.create({
    companyId: new Types.ObjectId(companyId),
    name: body.name,
    templateId: body.templateId ? new Types.ObjectId(body.templateId) : undefined,
    whatsappNumberId: new Types.ObjectId(body.whatsappNumberId),
    contactGroupIds: (body.contactGroupIds ?? []).map((id) => new Types.ObjectId(id)),
    contactIds: (body.contactIds ?? []).map((id) => new Types.ObjectId(id)),
    scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
    status: 'draft',
  });
  res.status(201).json(c);
}

export async function updateCampaign(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const { id } = req.params as { id: string };
  const body = req.body as Partial<{
    name: string;
    templateId: string;
    whatsappNumberId: string;
    contactGroupIds: string[];
    contactIds: string[];
    scheduledAt: string;
  }>;
  const update: Record<string, unknown> = {};
  if (body.name) update.name = body.name;
  if (body.templateId) update.templateId = new Types.ObjectId(body.templateId);
  if (body.whatsappNumberId) {
    try {
      await assertWhatsappNumberForCompany(companyId, body.whatsappNumberId);
    } catch (e) {
      res.status(400).json({ error: e instanceof Error ? e.message : 'Invalid sender' });
      return;
    }
    update.whatsappNumberId = new Types.ObjectId(body.whatsappNumberId);
  }
  if (body.contactGroupIds)
    update.contactGroupIds = body.contactGroupIds.map((x) => new Types.ObjectId(x));
  if (body.contactIds) update.contactIds = body.contactIds.map((x) => new Types.ObjectId(x));
  if (body.scheduledAt) update.scheduledAt = new Date(body.scheduledAt);

  const c = await CampaignModel.findOneAndUpdate(
    { _id: id, companyId: new Types.ObjectId(companyId), deletedAt: null },
    { $set: update },
    { new: true },
  );
  if (!c) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(c);
}

export async function startCampaignCtrl(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const { id } = req.params as { id: string };
  if (!id) {
    res.status(400).json({ error: 'Missing campaign id' });
    return;
  }
  try {
    await enqueueCampaign(id, companyId, req.user?.sub);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'start failed' });
  }
}

export async function pauseCampaignCtrl(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const { id } = req.params as { id: string };
  if (!id) {
    res.status(400).json({ error: 'Missing campaign id' });
    return;
  }
  await pauseCampaign(id, companyId);
  res.json({ ok: true });
}

export async function resumeCampaignCtrl(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const { id } = req.params as { id: string };
  if (!id) {
    res.status(400).json({ error: 'Missing campaign id' });
    return;
  }
  await resumeCampaign(id, companyId, req.user?.sub);
  res.json({ ok: true });
}

export async function deleteCampaign(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const { id } = req.params as { id: string };
  await CampaignModel.updateOne(
    { _id: id, companyId: new Types.ObjectId(companyId) },
    { $set: { deletedAt: new Date(), status: 'paused' } },
  );
  res.json({ ok: true });
}
