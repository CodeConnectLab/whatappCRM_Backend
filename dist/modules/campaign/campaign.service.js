import { Types } from 'mongoose';
import { CampaignMessageModel } from './campaign-message.model.js';
import { CampaignModel } from './campaign.model.js';
import { ContactGroupModel } from '../contact/contact-group.model.js';
import { ContactModel } from '../contact/contact.model.js';
import { TemplateModel } from '../template/template.model.js';
import { campaignQueue } from './campaign.queue.js';
import { logActivity } from '../activity/activity.service.js';
import { applyTemplate } from '../../utils/templateRender.js';
import { assertCampaignCanStart } from '../meta/whatsapp-readiness.service.js';
async function addCampaignJob(companyId, campaignId, contactId) {
    try {
        await campaignQueue.add('send', { companyId, campaignId, contactId }, {
            jobId: `camp-${campaignId}-${contactId}`,
            attempts: 5,
            backoff: { type: 'exponential', delay: 5000 },
            removeOnComplete: true,
        });
    }
    catch {
        /* duplicate BullMQ job id */
    }
}
export async function enqueueCampaign(campaignId, companyId, userId) {
    const campaign = await CampaignModel.findOne({
        _id: new Types.ObjectId(campaignId),
        companyId: new Types.ObjectId(companyId),
        deletedAt: null,
    }).lean();
    if (!campaign)
        throw new Error('Campaign not found');
    const contactIdSet = new Set();
    for (const id of campaign.contactIds ?? []) {
        contactIdSet.add(String(id));
    }
    if (campaign.contactGroupIds?.length) {
        const groups = await ContactGroupModel.find({
            _id: { $in: campaign.contactGroupIds },
            companyId: new Types.ObjectId(companyId),
            deletedAt: null,
        }).lean();
        for (const g of groups) {
            for (const cid of g.contactIds ?? []) {
                contactIdSet.add(String(cid));
            }
        }
    }
    const contacts = await ContactModel.find({
        _id: { $in: [...contactIdSet].map((id) => new Types.ObjectId(id)) },
        companyId: new Types.ObjectId(companyId),
        deletedAt: null,
    }).lean();
    let body = '';
    let mediaUrl;
    if (campaign.templateId) {
        const t = await TemplateModel.findById(campaign.templateId).lean();
        body = t?.body ?? '';
        const rawUrl = t?.imageUrl != null ? String(t.imageUrl).trim() : '';
        mediaUrl = rawUrl.length > 0 ? rawUrl : undefined;
    }
    if (!body)
        throw new Error('Campaign has no template body');
    await assertCampaignCanStart(companyId, {
        whatsappNumberId: campaign.whatsappNumberId,
        templateId: campaign.templateId,
        recipientCount: contacts.length,
    });
    await CampaignModel.updateOne({ _id: campaign._id }, { $set: { status: 'running', stats: { total: contacts.length, sent: 0, failed: 0 } } });
    for (const c of contacts) {
        const personalized = applyTemplate(body, { name: c.name, phone: c.phone, email: c.email });
        await CampaignMessageModel.updateOne({
            companyId: new Types.ObjectId(companyId),
            campaignId: campaign._id,
            contactId: c._id,
        }, {
            $setOnInsert: {
                body: personalized,
                ...(mediaUrl ? { mediaUrl } : {}),
                status: 'pending',
            },
        }, { upsert: true });
        await addCampaignJob(companyId, String(campaign._id), String(c._id));
    }
    await logActivity({
        companyId,
        userId: userId ?? null,
        action: 'campaign.started',
        resource: 'campaign',
        resourceId: String(campaign._id),
        meta: { recipients: contacts.length },
    });
}
export async function pauseCampaign(campaignId, companyId) {
    await CampaignModel.updateOne({ _id: new Types.ObjectId(campaignId), companyId: new Types.ObjectId(companyId) }, { $set: { status: 'paused' } });
}
export async function resumeCampaign(campaignId, companyId, userId) {
    const campaign = await CampaignModel.findOne({
        _id: new Types.ObjectId(campaignId),
        companyId: new Types.ObjectId(companyId),
        deletedAt: null,
    }).lean();
    if (!campaign)
        throw new Error('Campaign not found');
    const outstanding = await CampaignMessageModel.countDocuments({
        campaignId: new Types.ObjectId(campaignId),
        companyId: new Types.ObjectId(companyId),
        status: { $in: ['pending', 'failed', 'queued'] },
        $or: [{ twilioSid: { $exists: false } }, { twilioSid: null }, { twilioSid: '' }],
    });
    // Re-run the same checks as a fresh start, sized to what is actually left: a campaign
    // paused for want of credits, or with an expired token, would otherwise resume
    // straight into a wall of failures.
    await assertCampaignCanStart(companyId, {
        whatsappNumberId: campaign.whatsappNumberId,
        templateId: campaign.templateId,
        recipientCount: outstanding,
    });
    await CampaignModel.updateOne({ _id: new Types.ObjectId(campaignId), companyId: new Types.ObjectId(companyId) }, { $set: { status: 'running' } });
    const pending = await CampaignMessageModel.find({
        campaignId: new Types.ObjectId(campaignId),
        companyId: new Types.ObjectId(companyId),
        status: { $in: ['pending', 'failed', 'queued'] },
        $or: [{ twilioSid: { $exists: false } }, { twilioSid: null }, { twilioSid: '' }],
    }).lean();
    for (const m of pending) {
        await addCampaignJob(companyId, campaignId, String(m.contactId));
    }
    await logActivity({
        companyId,
        userId: userId ?? null,
        action: 'campaign.resumed',
        resource: 'campaign',
        resourceId: campaignId,
    });
}
/**
 * Applies a Meta delivery status to a campaign message.
 *
 * Campaign sends live in their own collection, so the webhook's update to `Message`
 * never reached them: every finished campaign read "sent" forever, even for messages
 * Meta went on to reject. Called for every status update; a sid that belongs to an
 * ordinary chat message simply matches nothing.
 */
export async function applyCampaignMessageStatus(input) {
    const cm = await CampaignMessageModel.findOne({
        companyId: new Types.ObjectId(input.companyId),
        twilioSid: input.sid,
    })
        .select('_id campaignId status')
        .lean();
    if (!cm)
        return;
    // read > delivered > sent: a late-arriving 'delivered' must not undo a 'read'.
    const rank = { sent: 1, delivered: 2, read: 3, failed: 3 };
    const current = rank[String(cm.status)] ?? 0;
    if (input.status !== 'failed' && current >= (rank[input.status] ?? 0))
        return;
    await CampaignMessageModel.updateOne({ _id: cm._id }, {
        $set: {
            status: input.status,
            ...(input.error ? { error: input.error } : {}),
            ...(input.pricing ? { billing: { ...input.pricing, recordedAt: new Date() } } : {}),
        },
    });
    // A message Meta accepted and then rejected was counted as sent; move the count.
    if (input.status === 'failed' && cm.status !== 'failed') {
        await CampaignModel.updateOne({ _id: cm.campaignId }, { $inc: { 'stats.failed': 1, 'stats.sent': cm.status === 'sent' ? -1 : 0 } });
    }
    await settleCampaignIfFinished(String(cm.campaignId));
}
/**
 * Moves a campaign to `completed` once every recipient has an outcome.
 *
 * `completed` was in the status enum from the start and nothing ever set it, so every
 * finished campaign stayed "running".
 */
export async function settleCampaignIfFinished(campaignId) {
    const camp = await CampaignModel.findById(new Types.ObjectId(campaignId))
        .select('status stats')
        .lean();
    if (!camp || camp.status !== 'running')
        return;
    const total = camp.stats?.total ?? 0;
    const done = (camp.stats?.sent ?? 0) + (camp.stats?.failed ?? 0);
    if (total <= 0 || done < total)
        return;
    await CampaignModel.updateOne({ _id: new Types.ObjectId(campaignId), status: 'running' }, { $set: { status: 'completed', completedAt: new Date() } });
}
