import { Types } from 'mongoose';
import { TemplateModel } from './template.model.js';
import { extractVariables, toPositionalBody, toMetaTemplateName, } from './template.service.js';
import { submitMetaTemplate, fetchMetaTemplates, deleteMetaTemplate, } from '../meta/meta.service.js';
import { logger } from '../../utils/logger.js';
export async function listTemplates(req, res) {
    const companyId = req.companyId;
    const rows = await TemplateModel.find({
        companyId: new Types.ObjectId(companyId),
        deletedAt: null,
    }).lean();
    res.json(rows);
}
export async function createTemplate(req, res) {
    const companyId = req.companyId;
    const { name, body, language, imageUrl, category } = req.body;
    const t = await TemplateModel.create({
        companyId: new Types.ObjectId(companyId),
        name,
        body,
        language,
        ...(category ? { category } : {}),
        ...(imageUrl ? { imageUrl } : {}),
        variables: extractVariables(body),
        metaTemplateName: toMetaTemplateName(name),
        status: 'local',
    });
    res.status(201).json(t);
}
export async function updateTemplate(req, res) {
    const companyId = req.companyId;
    const { id } = req.params;
    const body = req.body;
    const setDoc = {};
    if (body.name !== undefined) {
        setDoc.name = body.name;
        setDoc.metaTemplateName = toMetaTemplateName(body.name);
    }
    if (body.body !== undefined) {
        setDoc.body = body.body;
        setDoc.variables = extractVariables(body.body);
        // Meta templates are immutable once submitted — editing means resubmitting.
        setDoc.status = 'local';
        setDoc.metaTemplateId = undefined;
    }
    if (body.language !== undefined)
        setDoc.language = body.language;
    if (body.category !== undefined)
        setDoc.category = body.category;
    const unsetDoc = {};
    if (body.imageUrl !== undefined) {
        if (body.imageUrl === null || body.imageUrl === '') {
            unsetDoc.imageUrl = 1;
        }
        else {
            setDoc.imageUrl = body.imageUrl;
        }
    }
    const update = {};
    if (Object.keys(setDoc).length)
        update.$set = setDoc;
    if (Object.keys(unsetDoc).length)
        update.$unset = unsetDoc;
    if (!Object.keys(update).length) {
        const existing = await TemplateModel.findOne({
            _id: id,
            companyId: new Types.ObjectId(companyId),
            deletedAt: null,
        });
        if (!existing) {
            res.status(404).json({ error: 'Not found' });
            return;
        }
        res.json(existing);
        return;
    }
    const t = await TemplateModel.findOneAndUpdate({ _id: id, companyId: new Types.ObjectId(companyId), deletedAt: null }, update, { new: true });
    if (!t) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    res.json(t);
}
export async function deleteTemplate(req, res) {
    const companyId = req.companyId;
    const { id } = req.params;
    const t = await TemplateModel.findOne({
        _id: id,
        companyId: new Types.ObjectId(companyId),
    }).lean();
    if (t?.metaTemplateId && t.metaTemplateName) {
        try {
            await deleteMetaTemplate(companyId, t.metaTemplateName);
        }
        catch (e) {
            // Already gone on Meta's side, or credentials changed — local delete still proceeds.
            logger.warn('Meta template delete failed', {
                companyId,
                name: t.metaTemplateName,
                err: e instanceof Error ? e.message : e,
            });
        }
    }
    await TemplateModel.updateOne({ _id: id, companyId: new Types.ObjectId(companyId) }, { $set: { deletedAt: new Date() } });
    res.json({ ok: true });
}
/** Sends the template to Meta for review. Approval typically takes minutes to 24h. */
export async function submitTemplate(req, res) {
    const companyId = req.companyId;
    const { id } = req.params;
    const t = await TemplateModel.findOne({
        _id: id,
        companyId: new Types.ObjectId(companyId),
        deletedAt: null,
    });
    if (!t) {
        res.status(404).json({ error: 'Not found' });
        return;
    }
    if (t.status === 'APPROVED' || t.status === 'PENDING') {
        res.status(409).json({ error: `Template already ${t.status.toLowerCase()} on Meta` });
        return;
    }
    const variables = extractVariables(t.body);
    const metaTemplateName = t.metaTemplateName?.trim() || toMetaTemplateName(t.name);
    const { metaTemplateId, status } = await submitMetaTemplate({
        companyId,
        metaTemplateName,
        positionalBody: toPositionalBody(t.body, variables),
        variables,
        category: t.category ?? 'UTILITY',
        language: t.language ?? 'en',
        ...(t.imageUrl?.trim() ? { headerImageUrl: t.imageUrl.trim() } : {}),
    });
    t.set({
        metaTemplateId,
        metaTemplateName,
        variables,
        status: status,
        submittedAt: new Date(),
        rejectedReason: undefined,
    });
    await t.save();
    res.json(t);
}
/** Pulls current review status for every template from Meta. */
export async function syncTemplates(req, res) {
    const companyId = req.companyId;
    const remote = await fetchMetaTemplates(companyId);
    const byName = new Map(remote.map((r) => [r.name, r]));
    const locals = await TemplateModel.find({
        companyId: new Types.ObjectId(companyId),
        deletedAt: null,
    });
    let updated = 0;
    for (const t of locals) {
        const name = t.metaTemplateName?.trim() || toMetaTemplateName(t.name);
        const match = byName.get(name);
        if (!match)
            continue;
        t.set({
            metaTemplateId: match.id,
            metaTemplateName: name,
            status: match.status,
            ...(match.category ? { category: match.category } : {}),
            rejectedReason: match.rejected_reason ?? undefined,
            syncedAt: new Date(),
        });
        await t.save();
        updated += 1;
    }
    res.json({ ok: true, checked: locals.length, updated, remote: remote.length });
}
