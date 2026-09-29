import { Types } from 'mongoose';
import { QuickReplyModel } from './quick-reply.model.js';
export async function listQuickReplies(companyId) {
    return QuickReplyModel.find({ companyId: new Types.ObjectId(companyId), deletedAt: null })
        .sort({ useCount: -1, title: 1 })
        .lean();
}
export async function createQuickReply(companyId, userId, input) {
    return QuickReplyModel.create({
        companyId: new Types.ObjectId(companyId),
        title: input.title.trim(),
        body: input.body,
        ...(input.shortcut?.trim() ? { shortcut: normalizeShortcut(input.shortcut) } : {}),
        ...(input.mediaId ? { mediaId: new Types.ObjectId(input.mediaId) } : {}),
        createdBy: new Types.ObjectId(userId),
        deletedAt: null,
    });
}
/** Stored without the leading slash, so "/price" and "price" resolve to the same reply. */
function normalizeShortcut(raw) {
    return raw.trim().replace(/^\//, '').toLowerCase();
}
export async function updateQuickReply(companyId, id, input) {
    const set = {};
    const unset = {};
    if (input.title !== undefined)
        set.title = input.title.trim();
    if (input.body !== undefined)
        set.body = input.body;
    if (input.shortcut !== undefined) {
        if (input.shortcut)
            set.shortcut = normalizeShortcut(input.shortcut);
        else
            unset.shortcut = '';
    }
    if (input.mediaId !== undefined) {
        if (input.mediaId)
            set.mediaId = new Types.ObjectId(input.mediaId);
        else
            unset.mediaId = '';
    }
    return QuickReplyModel.findOneAndUpdate({ _id: new Types.ObjectId(id), companyId: new Types.ObjectId(companyId), deletedAt: null }, {
        ...(Object.keys(set).length ? { $set: set } : {}),
        ...(Object.keys(unset).length ? { $unset: unset } : {}),
    }, { new: true }).lean();
}
export async function deleteQuickReply(companyId, id) {
    const res = await QuickReplyModel.updateOne({ _id: new Types.ObjectId(id), companyId: new Types.ObjectId(companyId), deletedAt: null }, { $set: { deletedAt: new Date() } });
    return res.modifiedCount > 0;
}
/** Bumps the counter that orders the picker by what the team actually uses. */
export async function recordQuickReplyUse(companyId, id) {
    await QuickReplyModel.updateOne({ _id: new Types.ObjectId(id), companyId: new Types.ObjectId(companyId), deletedAt: null }, { $inc: { useCount: 1 } });
}
