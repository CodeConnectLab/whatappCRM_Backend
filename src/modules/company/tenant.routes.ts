import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { idParamSchema, validateRequest } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { tenantMiddleware } from '../../middleware/tenant.js';
import { requireCompanyAdmin, requireAgent } from '../../middleware/rbac.js';
import * as companyCtrl from './company.controller.js';
import * as twilioCtrl from '../twilio/twilio.controller.js';
import * as contactCtrl from '../contact/contact.controller.js';
import * as activityCtrl from '../activity/activity.controller.js';
import * as metaCtrl from '../meta/meta.controller.js';
import * as crmCtrl from '../crm/crm-bridge.controller.js';
import * as campaignCtrl from '../campaign/campaign.controller.js';
import * as templateCtrl from '../template/template.controller.js';
import * as chatCtrl from '../chat/chat.controller.js';
import * as mediaCtrl from '../media/media.controller.js';
import * as walletCtrl from '../wallet/wallet.controller.js';
import * as productCtrl from '../product/product.controller.js';
import * as autoCtrl from '../automation/auto-response.controller.js';
import { companyValidation } from './company.validation.js';
import { twilioValidation } from '../twilio/twilio.validation.js';
import { contactValidation } from '../contact/contact.validation.js';
import { campaignValidation } from '../campaign/campaign.validation.js';
import { templateValidation } from '../template/template.validation.js';
import { chatValidation } from '../chat/chat.validation.js';
import { mediaValidation } from '../media/media.validation.js';
import { metaValidation } from '../meta/meta.validation.js';
import { crmBridgeValidation } from '../crm/crm-bridge.validation.js';
import { productValidation } from '../product/product.validation.js';
import { autoResponseValidation } from '../automation/auto-response.validation.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

export function createTenantRouter(): Router {
  const tenant = Router();
  tenant.use(requireAuth, tenantMiddleware, requireAgent);

  tenant.get('/workspace/summary', asyncHandler(companyCtrl.getWorkspaceSummary));
  tenant.get('/activity-logs', asyncHandler(activityCtrl.listActivityLogs));

  tenant.get('/team', asyncHandler(companyCtrl.listTeam));
  /** Creates the login and the membership in one step — no prior registration needed. */
  tenant.post(
    '/team/users',
    requireCompanyAdmin,
    validateRequest({ body: companyValidation.createUser }),
    asyncHandler(companyCtrl.createUser),
  );
  tenant.patch(
    '/team/members/:id',
    requireCompanyAdmin,
    validateRequest(companyValidation.updateMember),
    asyncHandler(companyCtrl.patchMember),
  );
  tenant.delete(
    '/team/members/:id',
    requireCompanyAdmin,
    validateRequest(companyValidation.memberById),
    asyncHandler(companyCtrl.deleteMember),
  );
  tenant.post(
    '/team/members/:id/password',
    requireCompanyAdmin,
    validateRequest(companyValidation.resetMemberPassword),
    asyncHandler(companyCtrl.resetMemberPassword),
  );
  /** Legacy path: attach an account that already exists. */
  tenant.post(
    '/team/invite',
    requireCompanyAdmin,
    validateRequest({ body: companyValidation.inviteMember }),
    asyncHandler(companyCtrl.inviteMember),
  );

  tenant.get('/twilio/accounts', asyncHandler(twilioCtrl.listTwilioAccounts));
  tenant.post(
    '/twilio/accounts',
    requireCompanyAdmin,
    validateRequest({ body: twilioValidation.upsertAccount }),
    asyncHandler(twilioCtrl.upsertTwilioAccount),
  );
  tenant.get('/twilio/numbers', asyncHandler(twilioCtrl.listWhatsappNumbers));
  tenant.post(
    '/twilio/numbers',
    requireCompanyAdmin,
    validateRequest({ body: twilioValidation.upsertNumber }),
    asyncHandler(twilioCtrl.upsertWhatsappNumber),
  );

  tenant.get('/meta/whatsapp-config', requireCompanyAdmin, asyncHandler(metaCtrl.getMetaWhatsappConfig));
  tenant.post(
    '/meta/whatsapp-config',
    requireCompanyAdmin,
    validateRequest({ body: metaValidation.upsertConfig }),
    asyncHandler(metaCtrl.upsertMetaWhatsappConfig),
  );

  tenant.get('/crm/bridge', requireCompanyAdmin, asyncHandler(crmCtrl.getCrmBridgeConfig));
  tenant.post(
    '/crm/bridge',
    requireCompanyAdmin,
    validateRequest({ body: crmBridgeValidation.upsert }),
    asyncHandler(crmCtrl.upsertCrmBridgeConfig),
  );
  tenant.delete('/crm/bridge', requireCompanyAdmin, asyncHandler(crmCtrl.removeCrmBridgeConfig));
  tenant.post('/crm/bridge/test', requireCompanyAdmin, asyncHandler(crmCtrl.testCrmBridgeConnection));
  tenant.post(
    '/crm/bridge/chats/:id/resync',
    requireCompanyAdmin,
    validateRequest({ params: idParamSchema }),
    asyncHandler(crmCtrl.resyncChatToCrm),
  );

  tenant.get('/contacts/import/template', asyncHandler(contactCtrl.downloadContactImportTemplate));
  tenant.post(
    '/contacts/import',
    upload.single('file'),
    asyncHandler(contactCtrl.importContactsCsv),
  );

  tenant.get('/contacts', asyncHandler(contactCtrl.listContacts));
  tenant.post(
    '/contacts',
    validateRequest({ body: contactValidation.createContact }),
    asyncHandler(contactCtrl.createContact),
  );
  tenant.patch(
    '/contacts/:id',
    validateRequest(contactValidation.updateContact),
    asyncHandler(contactCtrl.updateContact),
  );
  tenant.delete(
    '/contacts/:id',
    validateRequest(contactValidation.deleteContact),
    asyncHandler(contactCtrl.deleteContact),
  );

  tenant.get('/contact-groups', asyncHandler(contactCtrl.listGroups));
  tenant.post(
    '/contact-groups',
    validateRequest({ body: contactValidation.createGroup }),
    asyncHandler(contactCtrl.createGroup),
  );
  tenant.patch(
    '/contact-groups/:id',
    validateRequest(contactValidation.updateGroup),
    asyncHandler(contactCtrl.updateGroup),
  );

  tenant.get('/campaigns', asyncHandler(campaignCtrl.listCampaigns));
  tenant.post(
    '/campaigns',
    requireCompanyAdmin,
    validateRequest({ body: campaignValidation.create }),
    asyncHandler(campaignCtrl.createCampaign),
  );
  tenant.patch(
    '/campaigns/:id',
    requireCompanyAdmin,
    validateRequest(campaignValidation.update),
    asyncHandler(campaignCtrl.updateCampaign),
  );
  tenant.post(
    '/campaigns/:id/start',
    requireCompanyAdmin,
    validateRequest(campaignValidation.byId),
    asyncHandler(campaignCtrl.startCampaignCtrl),
  );
  tenant.post(
    '/campaigns/:id/pause',
    requireCompanyAdmin,
    validateRequest(campaignValidation.byId),
    asyncHandler(campaignCtrl.pauseCampaignCtrl),
  );
  tenant.post(
    '/campaigns/:id/resume',
    requireCompanyAdmin,
    validateRequest(campaignValidation.byId),
    asyncHandler(campaignCtrl.resumeCampaignCtrl),
  );
  tenant.delete(
    '/campaigns/:id',
    requireCompanyAdmin,
    validateRequest(campaignValidation.byId),
    asyncHandler(campaignCtrl.deleteCampaign),
  );

  tenant.get('/templates', asyncHandler(templateCtrl.listTemplates));
  tenant.post(
    '/templates',
    requireCompanyAdmin,
    validateRequest({ body: templateValidation.create }),
    asyncHandler(templateCtrl.createTemplate),
  );
  tenant.post(
    '/templates/sync',
    requireCompanyAdmin,
    asyncHandler(templateCtrl.syncTemplates),
  );
  tenant.post(
    '/templates/:id/submit',
    requireCompanyAdmin,
    validateRequest(templateValidation.submit),
    asyncHandler(templateCtrl.submitTemplate),
  );
  tenant.patch(
    '/templates/:id',
    requireCompanyAdmin,
    validateRequest(templateValidation.update),
    asyncHandler(templateCtrl.updateTemplate),
  );
  tenant.delete(
    '/templates/:id',
    requireCompanyAdmin,
    validateRequest(templateValidation.delete),
    asyncHandler(templateCtrl.deleteTemplate),
  );

  tenant.get(
    '/chats',
    validateRequest({ query: chatValidation.listQuery }),
    asyncHandler(chatCtrl.getChats),
  );
  tenant.get('/leads/counts', asyncHandler(chatCtrl.getLeadCounts));
  /** Who the round-robin would consider, with each member's current load. */
  tenant.get('/leads/assignees', requireCompanyAdmin, asyncHandler(chatCtrl.getAssignmentCandidates));
  tenant.post('/leads/distribute', requireCompanyAdmin, asyncHandler(chatCtrl.postDistributeLeads));
  tenant.post(
    '/chats',
    validateRequest(chatValidation.createChat),
    asyncHandler(chatCtrl.createChat),
  );
  tenant.get(
    '/chats/:chatId/messages',
    validateRequest({
      params: chatValidation.messagesParams,
      query: chatValidation.messagesQuery,
    }),
    asyncHandler(chatCtrl.getMessages),
  );
  tenant.post(
    '/chats/:chatId/messages',
    validateRequest(chatValidation.postMessage),
    asyncHandler(chatCtrl.postMessage),
  );
  tenant.patch(
    '/chats/:chatId/status',
    validateRequest(chatValidation.updateStatus),
    asyncHandler(chatCtrl.patchLeadStatus),
  );
  /** Admin-only: an agent must not be able to pull a lead off a colleague. */
  tenant.patch(
    '/chats/:chatId/assignment',
    requireCompanyAdmin,
    validateRequest(chatValidation.updateAssignment),
    asyncHandler(chatCtrl.patchAssignment),
  );
  tenant.get(
    '/chats/:chatId/notes',
    validateRequest({ params: chatValidation.messagesParams }),
    asyncHandler(chatCtrl.getChatNotes),
  );
  tenant.post(
    '/chats/:chatId/notes',
    validateRequest(chatValidation.addNote),
    asyncHandler(chatCtrl.postChatNote),
  );
  tenant.delete(
    '/chats/:chatId/notes/:noteId',
    validateRequest(chatValidation.noteParams),
    asyncHandler(chatCtrl.removeChatNote),
  );

  tenant.post(
    '/media/presign',
    validateRequest({ body: mediaValidation.presign }),
    asyncHandler(mediaCtrl.presignUpload),
  );
  tenant.post(
    '/media/:id/complete',
    validateRequest(mediaValidation.complete),
    asyncHandler(mediaCtrl.completeUpload),
  );
  tenant.get(
    '/media/:id/url',
    validateRequest(mediaValidation.byId),
    asyncHandler(mediaCtrl.getMediaUrl),
  );
  tenant.get('/media', asyncHandler(mediaCtrl.listMedia));

  /* ----------------------------------------------- products & automation */

  tenant.get('/products', asyncHandler(productCtrl.getProducts));
  tenant.post(
    '/products',
    requireCompanyAdmin,
    validateRequest({ body: productValidation.create }),
    asyncHandler(productCtrl.postProduct),
  );
  tenant.patch(
    '/products/:id',
    requireCompanyAdmin,
    validateRequest(productValidation.update),
    asyncHandler(productCtrl.patchProduct),
  );
  tenant.delete(
    '/products/:id',
    requireCompanyAdmin,
    validateRequest(productValidation.byId),
    asyncHandler(productCtrl.removeProduct),
  );

  tenant.get('/auto-responses', requireCompanyAdmin, asyncHandler(autoCtrl.getAutoResponses));
  tenant.post(
    '/auto-responses',
    requireCompanyAdmin,
    validateRequest({ body: autoResponseValidation.create }),
    asyncHandler(autoCtrl.postAutoResponse),
  );
  tenant.patch(
    '/auto-responses/:id',
    requireCompanyAdmin,
    validateRequest(autoResponseValidation.update),
    asyncHandler(autoCtrl.patchAutoResponse),
  );
  tenant.delete(
    '/auto-responses/:id',
    requireCompanyAdmin,
    validateRequest(autoResponseValidation.byId),
    asyncHandler(autoCtrl.removeAutoResponse),
  );
  tenant.post(
    '/auto-responses/preview',
    requireCompanyAdmin,
    validateRequest({ body: autoResponseValidation.preview }),
    asyncHandler(autoCtrl.postAutoResponsePreview),
  );

  tenant.get('/wallet', asyncHandler(walletCtrl.getWalletCtrl));
  tenant.get('/wallet/transactions', asyncHandler(walletCtrl.listTransactions));
  tenant.patch(
    '/settings/company',
    requireCompanyAdmin,
    validateRequest({ body: companyValidation.updateCompanySettings }),
    asyncHandler(walletCtrl.updateCompanySettings),
  );

  return tenant;
}
