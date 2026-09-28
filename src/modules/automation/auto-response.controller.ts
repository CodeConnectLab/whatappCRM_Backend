import type { Request, Response } from 'express';
import {
  createAutoResponse,
  deleteAutoResponse,
  listAutoResponses,
  previewAutoResponse,
  updateAutoResponse,
} from './auto-response.service.js';
import { logActivity } from '../activity/activity.service.js';

export async function getAutoResponses(req: Request, res: Response): Promise<void> {
  res.json(await listAutoResponses(req.companyId!));
}

export async function postAutoResponse(req: Request, res: Response): Promise<void> {
  const rule = await createAutoResponse(req.companyId!, req.body as Record<string, unknown>);
  await logActivity({
    companyId: req.companyId!,
    userId: req.user!.sub,
    action: 'auto_response.created',
    resource: 'auto_response',
    resourceId: String(rule._id),
  });
  res.status(201).json(rule);
}

export async function patchAutoResponse(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const rule = await updateAutoResponse(req.companyId!, id, req.body as Record<string, unknown>);
  if (!rule) {
    res.status(404).json({ error: 'Auto-response not found' });
    return;
  }
  res.json(rule);
}

export async function removeAutoResponse(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const ok = await deleteAutoResponse(req.companyId!, id);
  if (!ok) {
    res.status(404).json({ error: 'Auto-response not found' });
    return;
  }
  res.json({ ok: true });
}

/** "Which rule would answer this lead?" — checked before a live ad points at it. */
export async function postAutoResponsePreview(req: Request, res: Response): Promise<void> {
  const match = await previewAutoResponse(
    req.companyId!,
    req.body as Parameters<typeof previewAutoResponse>[1],
  );
  res.json({ match });
}
