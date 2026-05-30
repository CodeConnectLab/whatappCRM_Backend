import { Router } from 'express';
import { healthCheck } from '../modules/health/health.controller.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { mountAuthRoutes } from '../modules/auth/auth.routes.js';
import { mountUserRoutes } from '../modules/user/user.routes.js';
import { createAdminRouter } from '../modules/company/admin.routes.js';
import { createTenantRouter } from '../modules/company/tenant.routes.js';

export const apiRouter = Router();

apiRouter.get('/health', asyncHandler(healthCheck));

mountAuthRoutes(apiRouter);
mountUserRoutes(apiRouter);

apiRouter.use('/admin', createAdminRouter());
apiRouter.use('/', createTenantRouter());
