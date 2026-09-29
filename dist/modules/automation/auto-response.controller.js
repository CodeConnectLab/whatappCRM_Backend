import { createAutoResponse, deleteAutoResponse, listAutoResponses, previewAutoResponse, updateAutoResponse, } from './auto-response.service.js';
import { logActivity } from '../activity/activity.service.js';
export async function getAutoResponses(req, res) {
    res.json(await listAutoResponses(req.companyId));
}
export async function postAutoResponse(req, res) {
    const rule = await createAutoResponse(req.companyId, req.body);
    await logActivity({
        companyId: req.companyId,
        userId: req.user.sub,
        action: 'auto_response.created',
        resource: 'auto_response',
        resourceId: String(rule._id),
    });
    res.status(201).json(rule);
}
export async function patchAutoResponse(req, res) {
    const { id } = req.params;
    const rule = await updateAutoResponse(req.companyId, id, req.body);
    if (!rule) {
        res.status(404).json({ error: 'Auto-response not found' });
        return;
    }
    res.json(rule);
}
export async function removeAutoResponse(req, res) {
    const { id } = req.params;
    const ok = await deleteAutoResponse(req.companyId, id);
    if (!ok) {
        res.status(404).json({ error: 'Auto-response not found' });
        return;
    }
    res.json({ ok: true });
}
/** "Which rule would answer this lead?" — checked before a live ad points at it. */
export async function postAutoResponsePreview(req, res) {
    const match = await previewAutoResponse(req.companyId, req.body);
    res.json({ match });
}
