import { Types } from 'mongoose';
import { ProductModel } from './product.model.js';

export type ProductMatchInput = {
  companyId: string;
  /** The lead's own words — the opening inbound message. */
  messageBody?: string | null;
  /** Meta ad or post id from the Click-to-WhatsApp referral. */
  adSourceId?: string | null;
  /** Ad headline from the referral. */
  adHeadline?: string | null;
  whatsappNumberId?: string | null;
};

function includesAny(haystack: string, needles: (string | null | undefined)[]): boolean {
  const hay = haystack.toLowerCase();
  return needles.some((n) => {
    const needle = n?.trim().toLowerCase();
    return Boolean(needle) && hay.includes(needle!);
  });
}

/**
 * Best product for a freshly arrived lead.
 *
 * Signals are tried strongest first: the ad id is set by Meta and cannot be faked, the
 * headline is close behind, keywords in the customer's message are a guess, and the
 * sender is the fallback for workspaces that run one number per brand. Returning null
 * is normal — plenty of leads simply do not map to a product.
 */
export async function matchProductForLead(
  input: ProductMatchInput,
): Promise<{ productId: string; name: string } | null> {
  const products = await ProductModel.find({
    companyId: new Types.ObjectId(input.companyId),
    deletedAt: null,
    active: true,
  }).lean();
  if (!products.length) return null;

  const adId = input.adSourceId?.trim();
  if (adId) {
    const byAd = products.find((p) => (p.adIds ?? []).some((id) => id.trim() === adId));
    if (byAd) return { productId: String(byAd._id), name: byAd.name };
  }

  const headline = input.adHeadline?.trim();
  if (headline) {
    const byCampaign = products.find((p) => includesAny(headline, p.campaignNames ?? []));
    if (byCampaign) return { productId: String(byCampaign._id), name: byCampaign.name };
  }

  const body = input.messageBody?.trim();
  if (body) {
    const byKeyword = products.find((p) => includesAny(body, p.keywords ?? []));
    if (byKeyword) return { productId: String(byKeyword._id), name: byKeyword.name };
  }

  const waId = input.whatsappNumberId?.trim();
  if (waId) {
    const byNumber = products.find((p) =>
      (p.whatsappNumberIds ?? []).some((id) => String(id) === waId),
    );
    if (byNumber) return { productId: String(byNumber._id), name: byNumber.name };
  }

  return null;
}

export async function listProducts(companyId: string) {
  return ProductModel.find({ companyId: new Types.ObjectId(companyId), deletedAt: null })
    .sort({ name: 1 })
    .lean();
}

export async function createProduct(
  companyId: string,
  input: {
    name: string;
    description?: string;
    keywords?: string[];
    adIds?: string[];
    campaignNames?: string[];
    whatsappNumberIds?: string[];
    crmLabel?: string;
    active?: boolean;
  },
) {
  return ProductModel.create({
    companyId: new Types.ObjectId(companyId),
    name: input.name.trim(),
    description: input.description,
    keywords: input.keywords ?? [],
    adIds: input.adIds ?? [],
    campaignNames: input.campaignNames ?? [],
    whatsappNumberIds: (input.whatsappNumberIds ?? []).map((id) => new Types.ObjectId(id)),
    crmLabel: input.crmLabel,
    active: input.active ?? true,
    deletedAt: null,
  });
}

export async function updateProduct(
  companyId: string,
  productId: string,
  input: Record<string, unknown>,
) {
  const set: Record<string, unknown> = {};
  for (const key of ['name', 'description', 'crmLabel', 'active'] as const) {
    if (input[key] !== undefined) set[key] = input[key];
  }
  for (const key of ['keywords', 'adIds', 'campaignNames'] as const) {
    if (input[key] !== undefined) set[key] = input[key];
  }
  if (input.whatsappNumberIds !== undefined) {
    set.whatsappNumberIds = (input.whatsappNumberIds as string[]).map((id) => new Types.ObjectId(id));
  }
  return ProductModel.findOneAndUpdate(
    { _id: new Types.ObjectId(productId), companyId: new Types.ObjectId(companyId), deletedAt: null },
    { $set: set },
    { new: true },
  ).lean();
}

export async function deleteProduct(companyId: string, productId: string): Promise<boolean> {
  const res = await ProductModel.updateOne(
    { _id: new Types.ObjectId(productId), companyId: new Types.ObjectId(companyId), deletedAt: null },
    { $set: { deletedAt: new Date() } },
  );
  return res.modifiedCount > 0;
}
