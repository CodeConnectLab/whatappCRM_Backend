import type { Request, Response } from 'express';
import { Types } from 'mongoose';
import { TemplateModel } from './template.model.js';

export async function listTemplates(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const rows = await TemplateModel.find({
    companyId: new Types.ObjectId(companyId),
    deletedAt: null,
  }).lean();
  res.json(rows);
}

export async function createTemplate(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const { name, body, language, imageUrl } = req.body as {
    name: string;
    body: string;
    language?: string;
    imageUrl?: string;
  };
  const t = await TemplateModel.create({
    companyId: new Types.ObjectId(companyId),
    name,
    body,
    language,
    ...(imageUrl ? { imageUrl } : {}),
  });
  res.status(201).json(t);
}

export async function updateTemplate(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const { id } = req.params;
  const body = req.body as Partial<{ name: string; body: string; language: string; imageUrl: string | null }>;
  const setDoc: Record<string, unknown> = {};
  if (body.name !== undefined) setDoc.name = body.name;
  if (body.body !== undefined) setDoc.body = body.body;
  if (body.language !== undefined) setDoc.language = body.language;
  const unsetDoc: Record<string, 1> = {};
  if (body.imageUrl !== undefined) {
    if (body.imageUrl === null || body.imageUrl === '') {
      unsetDoc.imageUrl = 1;
    } else {
      setDoc.imageUrl = body.imageUrl;
    }
  }
  const update: Record<string, unknown> = {};
  if (Object.keys(setDoc).length) update.$set = setDoc;
  if (Object.keys(unsetDoc).length) update.$unset = unsetDoc;
  if (!Object.keys(update).length) {
    const existing = await TemplateModel.findOne({
      _id: id,
      companyId: new Types.ObjectId(companyId),
      deletedAt: null,
    });
    if (!existing) {
      res.status(404).json({ error: 'Not found' });
      return;
    }
    res.json(existing);
    return;
  }
  const t = await TemplateModel.findOneAndUpdate(
    { _id: id, companyId: new Types.ObjectId(companyId), deletedAt: null },
    update,
    { new: true },
  );
  if (!t) {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  res.json(t);
}

export async function deleteTemplate(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const { id } = req.params;
  await TemplateModel.updateOne(
    { _id: id, companyId: new Types.ObjectId(companyId) },
    { $set: { deletedAt: new Date() } },
  );
  res.json({ ok: true });
}
