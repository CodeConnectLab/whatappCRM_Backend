import { getSubscriptionSnapshot } from './subscription.service.js';
export async function getSubscription(req, res) {
    const snapshot = await getSubscriptionSnapshot(req.companyId);
    if (!snapshot) {
        res.status(404).json({ error: 'Company not found' });
        return;
    }
    res.json(snapshot);
}
