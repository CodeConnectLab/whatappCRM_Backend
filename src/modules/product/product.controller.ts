import type { Request, Response } from 'express';
import {
  createProduct,
  deleteProduct,
  listProducts,
  updateProduct,
} from './product.service.js';
import { logActivity } from '../activity/activity.service.js';

export async function getProducts(req: Request, res: Response): Promise<void> {
  res.json(await listProducts(req.companyId!));
}

export async function postProduct(req: Request, res: Response): Promise<void> {
  try {
    const product = await createProduct(req.companyId!, req.body as Parameters<typeof createProduct>[1]);
    await logActivity({
      companyId: req.companyId!,
      userId: req.user!.sub,
      action: 'product.created',
      resource: 'product',
      resourceId: String(product._id),
    });
    res.status(201).json(product);
  } catch (e) {
    // The unique (companyId, name) index is the usual reason this fails.
    const message = e instanceof Error && /duplicate key/i.test(e.message)
      ? 'A product with that name already exists'
      : e instanceof Error
        ? e.message
        : 'Could not create product';
    res.status(400).json({ error: message });
  }
}

export async function patchProduct(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const product = await updateProduct(req.companyId!, id, req.body as Record<string, unknown>);
  if (!product) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }
  res.json(product);
}

export async function removeProduct(req: Request, res: Response): Promise<void> {
  const { id } = req.params as { id: string };
  const ok = await deleteProduct(req.companyId!, id);
  if (!ok) {
    res.status(404).json({ error: 'Product not found' });
    return;
  }
  res.json({ ok: true });
}
