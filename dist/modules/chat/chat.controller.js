import { ChatAccessError, addChatNote, assertChatAccess, deleteChatNote, getChatDetail, leadStatusCounts, listChatNotes, listChats, listMessages, markChatRead, openChatWithContact, sendChatTemplateMessage, sendOutboundChatMessage, setContactTags, updateLeadStatus, } from './chat.service.js';
import { createQuickReply, deleteQuickReply, listQuickReplies, updateQuickReply, } from './quick-reply.service.js';
import { distributeUnassignedLeads, listAssignmentCandidates, reassignChat, } from './lead-assignment.service.js';
/** Viewer identity every chat handler needs: super admins act as company admins. */
function viewerOf(req) {
    return {
        userId: req.user.sub,
        role: req.membershipRole === 'company_admin' ? 'company_admin' : 'agent',
    };
}
function fail(res, e, fallback = 'Request failed') {
    const status = e instanceof ChatAccessError ? e.status : 400;
    res.status(status).json({ error: e instanceof Error ? e.message : fallback });
}
export async function getChats(req, res) {
    const q = req.query;
    const filter = {
        ...(typeof q.assigned === 'string' ? { assigned: q.assigned } : {}),
        ...(typeof q.status === 'string' ? { status: q.status } : {}),
        ...(typeof q.productId === 'string' ? { productId: q.productId } : {}),
        ...(typeof q.search === 'string' ? { search: q.search } : {}),
        ...(q.adOnly === 'true' ? { adOnly: true } : {}),
    };
    const rows = await listChats(req.companyId, viewerOf(req), filter);
    res.json(rows);
}
export async function getLeadCounts(req, res) {
    const counts = await leadStatusCounts(req.companyId, viewerOf(req));
    res.json(counts);
}
export async function createChat(req, res) {
    const { contactId, whatsappNumberId } = req.body;
    try {
        const chat = await openChatWithContact({
            companyId: req.companyId,
            contactId,
            ...(whatsappNumberId ? { whatsappNumberId } : {}),
            userId: req.user.sub,
        });
        res.status(201).json(chat);
    }
    catch (e) {
        fail(res, e, 'Could not open chat');
    }
}
export async function getMessages(req, res) {
    const { chatId } = req.params;
    try {
        await assertChatAccess({ companyId: req.companyId, chatId, ...viewerOf(req) });
    }
    catch (e) {
        fail(res, e, 'Chat not found');
        return;
    }
    const q = req.query;
    const rows = await listMessages(req.companyId, chatId, {
        ...(typeof q.limit === 'string' ? { limit: Number(q.limit) } : {}),
        ...(typeof q.before === 'string' ? { before: q.before } : {}),
    });
    res.json(rows);
}
/** Clears the unread badge. Called by the inbox when an agent opens the thread. */
export async function markRead(req, res) {
    const { chatId } = req.params;
    try {
        await assertChatAccess({ companyId: req.companyId, chatId, ...viewerOf(req) });
        await markChatRead(req.companyId, chatId);
        res.json({ ok: true });
    }
    catch (e) {
        fail(res, e, 'Could not mark read');
    }
}
export async function getChatDetailCtrl(req, res) {
    const { chatId } = req.params;
    try {
        await assertChatAccess({ companyId: req.companyId, chatId, ...viewerOf(req) });
        res.json(await getChatDetail(req.companyId, chatId));
    }
    catch (e) {
        fail(res, e, 'Could not load chat');
    }
}
export async function postMessage(req, res) {
    const { chatId } = req.params;
    const { body, mediaId, templateId, quickReplyId } = req.body;
    try {
        await assertChatAccess({ companyId: req.companyId, chatId, ...viewerOf(req) });
        // A template send is a different WhatsApp call with its own billing and rendering,
        // not a free-form message that happens to carry canned text.
        const msg = templateId
            ? await sendChatTemplateMessage({
                companyId: req.companyId,
                userId: req.user.sub,
                chatId,
                templateId,
            })
            : await sendOutboundChatMessage({
                companyId: req.companyId,
                userId: req.user.sub,
                chatId,
                body: body ?? '',
                ...(mediaId ? { mediaId } : {}),
                ...(quickReplyId ? { quickReplyId } : {}),
            });
        res.status(201).json(msg);
    }
    catch (e) {
        fail(res, e, 'send failed');
    }
}
export async function patchContactTags(req, res) {
    const { chatId } = req.params;
    const { tags } = req.body;
    try {
        await assertChatAccess({ companyId: req.companyId, chatId, ...viewerOf(req) });
        res.json({ tags: await setContactTags({ companyId: req.companyId, chatId, tags }) });
    }
    catch (e) {
        fail(res, e, 'Could not update tags');
    }
}
/* ---------------------------------------------------------- quick replies */
export async function getQuickReplies(req, res) {
    res.json(await listQuickReplies(req.companyId));
}
export async function postQuickReply(req, res) {
    try {
        const reply = await createQuickReply(req.companyId, req.user.sub, req.body);
        res.status(201).json(reply);
    }
    catch (e) {
        const message = e instanceof Error && /duplicate key/i.test(e.message)
            ? 'A quick reply with that title already exists'
            : e instanceof Error
                ? e.message
                : 'Could not create quick reply';
        res.status(400).json({ error: message });
    }
}
export async function patchQuickReply(req, res) {
    const { id } = req.params;
    const reply = await updateQuickReply(req.companyId, id, req.body);
    if (!reply) {
        res.status(404).json({ error: 'Quick reply not found' });
        return;
    }
    res.json(reply);
}
export async function removeQuickReply(req, res) {
    const { id } = req.params;
    const ok = await deleteQuickReply(req.companyId, id);
    if (!ok) {
        res.status(404).json({ error: 'Quick reply not found' });
        return;
    }
    res.json({ ok: true });
}
/* --------------------------------------------------------------- lead ops */
export async function patchLeadStatus(req, res) {
    const { chatId } = req.params;
    const { status } = req.body;
    try {
        await assertChatAccess({ companyId: req.companyId, chatId, ...viewerOf(req) });
        const chat = await updateLeadStatus({
            companyId: req.companyId,
            chatId,
            actorUserId: req.user.sub,
            status,
        });
        res.json(chat);
    }
    catch (e) {
        fail(res, e, 'Could not update status');
    }
}
/** Reassignment is admin-only: an agent must not be able to hand a lead to themselves. */
export async function patchAssignment(req, res) {
    const { chatId } = req.params;
    const { assignedTo } = req.body;
    try {
        await reassignChat({
            companyId: req.companyId,
            chatId,
            actorUserId: req.user.sub,
            assignedTo: assignedTo ?? null,
        });
        res.json({ ok: true });
    }
    catch (e) {
        fail(res, e, 'Could not reassign lead');
    }
}
export async function getAssignmentCandidates(req, res) {
    const rows = await listAssignmentCandidates(req.companyId);
    res.json(rows);
}
export async function postDistributeLeads(req, res) {
    const result = await distributeUnassignedLeads({
        companyId: req.companyId,
        actorUserId: req.user.sub,
    });
    res.json(result);
}
/* ------------------------------------------------------------------ notes */
export async function getChatNotes(req, res) {
    const { chatId } = req.params;
    try {
        await assertChatAccess({ companyId: req.companyId, chatId, ...viewerOf(req) });
        res.json(await listChatNotes(req.companyId, chatId));
    }
    catch (e) {
        fail(res, e, 'Could not load notes');
    }
}
export async function postChatNote(req, res) {
    const { chatId } = req.params;
    const { body } = req.body;
    try {
        await assertChatAccess({ companyId: req.companyId, chatId, ...viewerOf(req) });
        const note = await addChatNote({
            companyId: req.companyId,
            chatId,
            userId: req.user.sub,
            body,
        });
        res.status(201).json(note);
    }
    catch (e) {
        fail(res, e, 'Could not add note');
    }
}
export async function removeChatNote(req, res) {
    const { chatId, noteId } = req.params;
    try {
        await assertChatAccess({ companyId: req.companyId, chatId, ...viewerOf(req) });
        await deleteChatNote({
            companyId: req.companyId,
            chatId,
            noteId,
            ...viewerOf(req),
        });
        res.json({ ok: true });
    }
    catch (e) {
        fail(res, e, 'Could not delete note');
    }
}
