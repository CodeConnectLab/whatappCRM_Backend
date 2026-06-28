import { Router } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { validateRequest } from "../../middleware/validate.js";
import { requireAuth } from "../../middleware/auth.js";
import { requireSuperAdmin } from "../../middleware/rbac.js";
import * as companyCtrl from "./company.controller.js";
import { companyValidation } from "./company.validation.js";
function createAdminRouter() {
  const admin = Router();
  admin.use(requireAuth, requireSuperAdmin);
  admin.get("/companies", asyncHandler(companyCtrl.listCompanies));
  admin.post(
    "/companies",
    validateRequest({ body: companyValidation.adminCreateCompany }),
    asyncHandler(companyCtrl.createCompanyAdmin)
  );
  admin.post(
    "/wallet/credit",
    validateRequest({ body: companyValidation.creditWallet }),
    asyncHandler(companyCtrl.creditCompanyWallet)
  );
  admin.post(
    "/users/super",
    validateRequest({ body: companyValidation.promoteSuperAdmin }),
    asyncHandler(companyCtrl.promoteSuperAdmin)
  );
  return admin;
}
export {
  createAdminRouter
};
