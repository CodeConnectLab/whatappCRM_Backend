import type { Request, Response } from 'express';
import {
  deleteCrmBridge,
  getCrmBridge,
  pushChatToCrm,
  testCrmBridge,
  upsertCrmBridge,
} from './crm-bridge.service.js';
import { logActivity } from '../activity/activity.service.js';

export async function getCrmBridgeConfig(req: Request, res: Response): Promise<void> {
  res.json(await getCrmBridge(req.companyId!));
}

export async function upsertCrmBridgeConfig(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const body = req.body as {
    enabled?: boolean;
    crmBaseUrl?: string;
    crmApiKey?: string;
    pushMode?: 'ad_only' | 'all_inbound';
    leadSourceLabel?: string;
  };

  try {
    const view = await upsertCrmBridge(companyId, body);
    await logActivity({
      companyId,
      userId: req.user?.sub ?? null,
      action: 'crm.bridge.upsert',
      resource: 'crm_bridge',
    });
    res.json(view);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Could not save CRM bridge' });
  }
}

export async function removeCrmBridgeConfig(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  await deleteCrmBridge(companyId);
  await logActivity({
    companyId,
    userId: req.user?.sub ?? null,
    action: 'crm.bridge.delete',
    resource: 'crm_bridge',
  });
  res.json({ ok: true });
}

export async function testCrmBridgeConnection(req: Request, res: Response): Promise<void> {
  const result = await testCrmBridge(req.companyId!);
  res.status(result.ok ? 200 : 400).json(result);
}

/** Manual retry for a conversation whose automatic push failed. */
export async function resyncChatToCrm(req: Request, res: Response): Promise<void> {
  const outcome = await pushChatToCrm(req.companyId!, String(req.params.id));
  res.json({ outcome });
}
