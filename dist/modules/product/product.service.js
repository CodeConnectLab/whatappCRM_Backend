import { Types } from 'mongoose';
import { ProductModel } from './product.model.js';
function includesAny(haystack, needles) {
    const hay = haystack.toLowerCase();
    return needles.some((n) => {
        const needle = n?.trim().toLowerCase();
        return Boolean(needle) && hay.includes(needle);
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
export async function matchProductForLead(input) {
    const products = await ProductModel.find({
        companyId: new Types.ObjectId(input.companyId),
        deletedAt: null,
        active: true,
    }).lean();
    if (!products.length)
        return null;
    const adId = input.adSourceId?.trim();
    if (adId) {
        const byAd = products.find((p) => (p.adIds ?? []).some((id) => id.trim() === adId));
        if (byAd)
            return { productId: String(byAd._id), name: byAd.name };
    }
    const headline = input.adHeadline?.trim();
    if (headline) {
        const byCampaign = products.find((p) => includesAny(headline, p.campaignNames ?? []));
        if (byCampaign)
            return { productId: String(byCampaign._id), name: byCampaign.name };
    }
    const body = input.messageBody?.trim();
    if (body) {
        const byKeyword = products.find((p) => includesAny(body, p.keywords ?? []));
        if (byKeyword)
            return { productId: String(byKeyword._id), name: byKeyword.name };
    }
    const waId = input.whatsappNumberId?.trim();
    if (waId) {
        const byNumber = products.find((p) => (p.whatsappNumberIds ?? []).some((id) => String(id) === waId));
        if (byNumber)
            return { productId: String(byNumber._id), name: byNumber.name };
    }
    return null;
}
export async function listProducts(companyId) {
    return ProductModel.find({ companyId: new Types.ObjectId(companyId), deletedAt: null })
        .sort({ name: 1 })
        .lean();
}
export async function createProduct(companyId, input) {
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
export async function updateProduct(companyId, productId, input) {
    const set = {};
    for (const key of ['name', 'description', 'crmLabel', 'active']) {
        if (input[key] !== undefined)
            set[key] = input[key];
    }
    for (const key of ['keywords', 'adIds', 'campaignNames']) {
        if (input[key] !== undefined)
            set[key] = input[key];
    }
    if (input.whatsappNumberIds !== undefined) {
        set.whatsappNumberIds = input.whatsappNumberIds.map((id) => new Types.ObjectId(id));
    }
    return ProductModel.findOneAndUpdate({ _id: new Types.ObjectId(productId), companyId: new Types.ObjectId(companyId), deletedAt: null }, { $set: set }, { new: true }).lean();
}
export async function deleteProduct(companyId, productId) {
    const res = await ProductModel.updateOne({ _id: new Types.ObjectId(productId), companyId: new Types.ObjectId(companyId), deletedAt: null }, { $set: { deletedAt: new Date() } });
    return res.modifiedCount > 0;
}
/**
 * Ad sources that have actually produced leads in this workspace.
 *
 * Operators should not have to go digging in Ads Manager for an ID to paste: Meta sends
 * `referral.source_id` on the first message of every Click-to-WhatsApp conversation and
 * we already store it. This lists what has been seen, most productive first, with the
 * product each id is mapped to so the gaps are obvious.
 */
export async function listAdSources(companyId, days = 90) {
    const { ChatModel } = await import('../chat/chat.model.js');
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const rows = await ChatModel.aggregate([
        {
            $match: {
                companyId: new Types.ObjectId(companyId),
                deletedAt: null,
                'referral.sourceId': { $type: 'string' },
                createdAt: { $gte: since },
            },
        },
        {
            $group: {
                _id: '$referral.sourceId',
                // $last over a createdAt sort gives the most recent creative text, which is what
                // an operator will recognise when the copy has been edited.
                sourceType: { $last: '$referral.sourceType' },
                headline: { $last: '$referral.headline' },
                leadCount: { $sum: 1 },
                lastSeenAt: { $max: '$createdAt' },
            },
        },
        { $sort: { leadCount: -1, lastSeenAt: -1 } },
        { $limit: 200 },
    ]);
    const products = await ProductModel.find({
        companyId: new Types.ObjectId(companyId),
        deletedAt: null,
    })
        .select('name adIds')
        .lean();
    const owner = new Map();
    for (const p of products) {
        for (const id of p.adIds ?? []) {
            owner.set(id.trim(), { productId: String(p._id), productName: p.name });
        }
    }
    return rows.map((r) => {
        const mapped = owner.get(r._id.trim());
        return {
            sourceId: r._id,
            ...(r.sourceType ? { sourceType: r.sourceType } : {}),
            ...(r.headline ? { headline: r.headline } : {}),
            leadCount: r.leadCount,
            ...(r.lastSeenAt ? { lastSeenAt: r.lastSeenAt.toISOString() } : {}),
            ...(mapped ?? {}),
        };
    });
}
