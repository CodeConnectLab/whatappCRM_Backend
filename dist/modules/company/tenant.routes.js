import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validateRequest } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';
import { requireCompanyAdmin, requireAgent } from '../../middleware/rbac.js';
import * as companyCtrl from './company.controller.js';
import * as twilioCtrl from '../twilio/twilio.controller.js';
import * as contactCtrl from '../contact/contact.controller.js';
import * as activityCtrl from '../activity/activity.controller.js';
import * as metaCtrl from '../meta/meta.controller.js';
import * as campaignCtrl from '../campaign/campaign.controller.js';
import * as templateCtrl from '../template/template.controller.js';
import * as chatCtrl from '../chat/chat.controller.js';
import * as mediaCtrl from '../media/media.controller.js';
import * as walletCtrl from '../wallet/wallet.controller.js';
import { companyValidation } from './company.validation.js';
import { twilioValidation } from '../twilio/twilio.validation.js';
import { contactValidation } from '../contact/contact.validation.js';
import { campaignValidation } from '../campaign/campaign.validation.js';
import { templateValidation } from '../template/template.validation.js';
import { chatValidation } from '../chat/chat.validation.js';
import { mediaValidation } from '../media/media.validation.js';
import { metaValidation } from '../meta/meta.validation.js';
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
});
export function createTenantRouter() {
    const tenant = Router();
    tenant.use(requireAuth, tenantMiddleware, requireAgent);
    tenant.get('/workspace/summary', asyncHandler(companyCtrl.getWorkspaceSummary));
    tenant.get('/activity-logs', asyncHandler(activityCtrl.listActivityLogs));
    tenant.get('/team', asyncHandler(companyCtrl.listTeam));
    tenant.post('/team/invite', requireCompanyAdmin, validateRequest({ body: companyValidation.inviteMember }), asyncHandler(companyCtrl.inviteMember));
    tenant.get('/twilio/accounts', asyncHandler(twilioCtrl.listTwilioAccounts));
    tenant.post('/twilio/accounts', requireCompanyAdmin, validateRequest({ body: twilioValidation.upsertAccount }), asyncHandler(twilioCtrl.upsertTwilioAccount));
    tenant.get('/twilio/numbers', asyncHandler(twilioCtrl.listWhatsappNumbers));
    tenant.post('/twilio/numbers', requireCompanyAdmin, validateRequest({ body: twilioValidation.upsertNumber }), asyncHandler(twilioCtrl.upsertWhatsappNumber));
    tenant.get('/meta/whatsapp-config', requireCompanyAdmin, asyncHandler(metaCtrl.getMetaWhatsappConfig));
    tenant.post('/meta/whatsapp-config', requireCompanyAdmin, validateRequest({ body: metaValidation.upsertConfig }), asyncHandler(metaCtrl.upsertMetaWhatsappConfig));
    tenant.get('/contacts/import/template', asyncHandler(contactCtrl.downloadContactImportTemplate));
    tenant.post('/contacts/import', upload.single('file'), asyncHandler(contactCtrl.importContactsCsv));
    tenant.get('/contacts', asyncHandler(contactCtrl.listContacts));
    tenant.post('/contacts', validateRequest({ body: contactValidation.createContact }), asyncHandler(contactCtrl.createContact));
    tenant.patch('/contacts/:id', validateRequest(contactValidation.updateContact), asyncHandler(contactCtrl.updateContact));
    tenant.delete('/contacts/:id', validateRequest(contactValidation.deleteContact), asyncHandler(contactCtrl.deleteContact));
    tenant.get('/contact-groups', asyncHandler(contactCtrl.listGroups));
    tenant.post('/contact-groups', validateRequest({ body: contactValidation.createGroup }), asyncHandler(contactCtrl.createGroup));
    tenant.patch('/contact-groups/:id', validateRequest(contactValidation.updateGroup), asyncHandler(contactCtrl.updateGroup));
    tenant.get('/campaigns', asyncHandler(campaignCtrl.listCampaigns));
    tenant.post('/campaigns', requireCompanyAdmin, validateRequest({ body: campaignValidation.create }), asyncHandler(campaignCtrl.createCampaign));
    tenant.patch('/campaigns/:id', requireCompanyAdmin, validateRequest(campaignValidation.update), asyncHandler(campaignCtrl.updateCampaign));
    tenant.post('/campaigns/:id/start', requireCompanyAdmin, validateRequest(campaignValidation.byId), asyncHandler(campaignCtrl.startCampaignCtrl));
    tenant.post('/campaigns/:id/pause', requireCompanyAdmin, validateRequest(campaignValidation.byId), asyncHandler(campaignCtrl.pauseCampaignCtrl));
    tenant.post('/campaigns/:id/resume', requireCompanyAdmin, validateRequest(campaignValidation.byId), asyncHandler(campaignCtrl.resumeCampaignCtrl));
    tenant.delete('/campaigns/:id', requireCompanyAdmin, validateRequest(campaignValidation.byId), asyncHandler(campaignCtrl.deleteCampaign));
    tenant.get('/templates', asyncHandler(templateCtrl.listTemplates));
    tenant.post('/templates', requireCompanyAdmin, validateRequest({ body: templateValidation.create }), asyncHandler(templateCtrl.createTemplate));
    tenant.post('/templates/sync', requireCompanyAdmin, asyncHandler(templateCtrl.syncTemplates));
    tenant.post('/templates/:id/submit', requireCompanyAdmin, validateRequest(templateValidation.submit), asyncHandler(templateCtrl.submitTemplate));
    tenant.patch('/templates/:id', requireCompanyAdmin, validateRequest(templateValidation.update), asyncHandler(templateCtrl.updateTemplate));
    tenant.delete('/templates/:id', requireCompanyAdmin, validateRequest(templateValidation.delete), asyncHandler(templateCtrl.deleteTemplate));
    tenant.get('/chats', asyncHandler(chatCtrl.getChats));
    tenant.post('/chats', validateRequest(chatValidation.createChat), asyncHandler(chatCtrl.createChat));
    tenant.get('/chats/:chatId/messages', validateRequest({
        params: chatValidation.messagesParams,
        query: chatValidation.messagesQuery,
    }), asyncHandler(chatCtrl.getMessages));
    tenant.post('/chats/:chatId/messages', validateRequest(chatValidation.postMessage), asyncHandler(chatCtrl.postMessage));
    tenant.post('/media/presign', validateRequest({ body: mediaValidation.presign }), asyncHandler(mediaCtrl.presignUpload));
    tenant.get('/media', asyncHandler(mediaCtrl.listMedia));
    tenant.get('/wallet', asyncHandler(walletCtrl.getWalletCtrl));
    tenant.get('/wallet/transactions', asyncHandler(walletCtrl.listTransactions));
    tenant.patch('/settings/company', requireCompanyAdmin, validateRequest({ body: companyValidation.updateCompanySettings }), asyncHandler(walletCtrl.updateCompanySettings));
    return tenant;
}
