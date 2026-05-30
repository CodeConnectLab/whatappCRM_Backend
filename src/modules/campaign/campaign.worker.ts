import { Worker } from 'bullmq';

import { Types } from 'mongoose';

import { CampaignMessageModel } from './campaign-message.model.js';

import { CampaignModel } from './campaign.model.js';

import { ContactModel } from '../contact/contact.model.js';

import { WhatsappNumberModel } from '../twilio/whatsapp-number.model.js';

import { CAMPAIGN_QUEUE } from './campaign.queue.js';

import { redisConnection } from './queue.connection.js';

import { debitCredits, getCreditPerMessage } from '../wallet/wallet.service.js';

import { sendWhatsappMessage } from '../messaging/messaging.service.js';

import { logger } from '../../utils/logger.js';



export interface CampaignJob {

  companyId: string;

  campaignId: string;

  contactId: string;

}



export function startCampaignWorker(): Worker<CampaignJob> {

  return new Worker<CampaignJob>(

    CAMPAIGN_QUEUE,

    async (job) => {

      const { companyId, campaignId, contactId } = job.data;

      const camp = await CampaignModel.findById(campaignId).lean();

      if (!camp || camp.status === 'paused' || camp.deletedAt) {

        return;

      }



      const cm = await CampaignMessageModel.findOne({

        companyId: new Types.ObjectId(companyId),

        campaignId: new Types.ObjectId(campaignId),

        contactId: new Types.ObjectId(contactId),

      }).lean();

      if (!cm || cm.status === 'sent' || cm.twilioSid) return;



      await CampaignMessageModel.updateOne(

        { _id: cm._id, status: { $ne: 'sent' } },

        { $set: { status: 'queued' } },

      );



      const contact = await ContactModel.findById(contactId).lean();

      if (!contact) {

        await CampaignMessageModel.updateOne(

          { _id: cm._id },

          { $set: { status: 'failed', error: 'contact missing' } },

        );

        return;

      }



      const wa = await WhatsappNumberModel.findOne({

        _id: camp.whatsappNumberId,

        companyId: new Types.ObjectId(companyId),

        deletedAt: null,

      }).lean();

      if (!wa) {

        await CampaignMessageModel.updateOne(

          { _id: cm._id },

          { $set: { status: 'failed', error: 'whatsapp number missing' } },

        );

        return;

      }



      try {

        const { sid } = await sendWhatsappMessage({

          companyId,

          whatsappNumberId: String(wa._id),

          toPhone: contact.phone,

          body: cm.body,

          ...(cm.mediaUrl && String(cm.mediaUrl).trim()

            ? { mediaUrl: [String(cm.mediaUrl).trim()] }

            : {}),

        });



        const marked = await CampaignMessageModel.findOneAndUpdate(

          { _id: cm._id, status: { $ne: 'sent' } },

          { $set: { status: 'sent', twilioSid: sid } },

          { new: true },

        );

        if (!marked) return;



        try {

          await debitCredits(companyId, getCreditPerMessage(), 'campaign_message', {

            campaignMessageId: String(cm._id),

          });

        } catch (debitErr) {

          logger.error('Campaign message sent but wallet debit failed', {

            campaignId,

            contactId,

            sid,

            err: debitErr,

          });

        }



        await CampaignModel.updateOne(

          { _id: camp._id },

          { $inc: { 'stats.sent': 1 } },

        );

      } catch (e) {

        const message = e instanceof Error ? e.message : 'send failed';

        logger.warn('Campaign send failed', { message, campaignId, contactId });

        await CampaignMessageModel.updateOne(

          { _id: cm._id, status: { $ne: 'sent' } },

          { $set: { status: 'failed', error: message } },

        );

        await CampaignModel.updateOne(

          { _id: camp._id },

          { $inc: { 'stats.failed': 1 } },

        );

        throw e;

      }

    },

    {

      connection: redisConnection,

      limiter: { max: 30, duration: 60_000 },

    },

  );

}


