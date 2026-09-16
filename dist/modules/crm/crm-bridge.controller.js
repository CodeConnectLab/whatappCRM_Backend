import { deleteCrmBridge, getCrmBridge, pushChatToCrm, testCrmBridge, upsertCrmBridge, } from './crm-bridge.service.js';
import { logActivity } from '../activity/activity.service.js';
export async function getCrmBridgeConfig(req, res) {
    res.json(await getCrmBridge(req.companyId));
}
export async function upsertCrmBridgeConfig(req, res) {
    const companyId = req.companyId;
    const body = req.body;
    try {
        const view = await upsertCrmBridge(companyId, body);
        await logActivity({
            companyId,
            userId: req.user?.sub ?? null,
            action: 'crm.bridge.upsert',
            resource: 'crm_bridge',
        });
        res.json(view);
    }
    catch (e) {
        res.status(400).json({ error: e instanceof Error ? e.message : 'Could not save CRM bridge' });
    }
}
export async function removeCrmBridgeConfig(req, res) {
    const companyId = req.companyId;
    await deleteCrmBridge(companyId);
    await logActivity({
        companyId,
        userId: req.user?.sub ?? null,
        action: 'crm.bridge.delete',
        resource: 'crm_bridge',
    });
    res.json({ ok: true });
}
export async function testCrmBridgeConnection(req, res) {
    const result = await testCrmBridge(req.companyId);
    res.status(result.ok ? 200 : 400).json(result);
}
/** Manual retry for a conversation whose automatic push failed. */
export async function resyncChatToCrm(req, res) {
    const outcome = await pushChatToCrm(req.companyId, String(req.params.id));
    res.json({ outcome });
}
