import { createProduct, deleteProduct, listAdSources, listProducts, updateProduct, } from './product.service.js';
import { logActivity } from '../activity/activity.service.js';
export async function getProducts(req, res) {
    res.json(await listProducts(req.companyId));
}
/** Ad IDs and headlines that have actually produced leads, for the mapping pickers. */
export async function getAdSources(req, res) {
    const q = req.query;
    const days = typeof q.days === 'string' ? Number(q.days) : undefined;
    res.json(await listAdSources(req.companyId, Number.isFinite(days) ? days : 90));
}
export async function postProduct(req, res) {
    try {
        const product = await createProduct(req.companyId, req.body);
        await logActivity({
            companyId: req.companyId,
            userId: req.user.sub,
            action: 'product.created',
            resource: 'product',
            resourceId: String(product._id),
        });
        res.status(201).json(product);
    }
    catch (e) {
        // The unique (companyId, name) index is the usual reason this fails.
        const message = e instanceof Error && /duplicate key/i.test(e.message)
            ? 'A product with that name already exists'
            : e instanceof Error
                ? e.message
                : 'Could not create product';
        res.status(400).json({ error: message });
    }
}
export async function patchProduct(req, res) {
    const { id } = req.params;
    const product = await updateProduct(req.companyId, id, req.body);
    if (!product) {
        res.status(404).json({ error: 'Product not found' });
        return;
    }
    res.json(product);
}
export async function removeProduct(req, res) {
    const { id } = req.params;
    const ok = await deleteProduct(req.companyId, id);
    if (!ok) {
        res.status(404).json({ error: 'Product not found' });
        return;
    }
    res.json({ ok: true });
}
