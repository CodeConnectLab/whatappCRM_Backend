import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { validateRequest } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import * as authCtrl from './auth.controller.js';
import { authValidation } from './auth.validation.js';

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 100 });
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 40 });

export function mountAuthRoutes(api: Router): void {
  api.post(
    '/auth/register',
    authLimiter,
    validateRequest({ body: authValidation.register }),
    asyncHandler(authCtrl.register),
  );
  api.post(
    '/auth/login',
    loginLimiter,
    validateRequest({ body: authValidation.login }),
    asyncHandler(authCtrl.login),
  );
  api.post('/auth/refresh', validateRequest({ body: authValidation.refresh }), asyncHandler(authCtrl.refresh));
  api.post(
    '/auth/forgot-password',
    validateRequest({ body: authValidation.forgotPassword }),
    asyncHandler(authCtrl.forgotPassword),
  );
  api.post(
    '/auth/change-password',
    requireAuth,
    validateRequest({ body: authValidation.changePassword }),
    asyncHandler(authCtrl.changePassword),
  );
  api.post(
    '/auth/reset-password',
    validateRequest({ body: authValidation.resetPassword }),
    asyncHandler(authCtrl.resetPassword),
  );
}
