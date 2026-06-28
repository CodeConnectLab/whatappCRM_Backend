import { asyncHandler } from "../../utils/asyncHandler.js";
import { requireAuth } from "../../middleware/auth.js";
import * as meCtrl from "./user.controller.js";
function mountUserRoutes(api) {
  api.get("/me", requireAuth, asyncHandler(meCtrl.me));
}
export {
  mountUserRoutes
};
