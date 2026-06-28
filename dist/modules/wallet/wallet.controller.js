import { Types } from "mongoose";
import { CompanyModel } from "../company/company.model.js";
import { TransactionModel } from "./transaction.model.js";
import { parsePagination, paginate } from "../../utils/pagination.js";
import { getWallet } from "./wallet.service.js";
async function getWalletCtrl(req, res) {
  const companyId = req.companyId;
  const w = await getWallet(companyId);
  res.json(w);
}
async function listTransactions(req, res) {
  const companyId = req.companyId;
  const opts = parsePagination(req.query);
  const filter = { companyId: new Types.ObjectId(companyId) };
  const result = await paginate(TransactionModel, filter, opts);
  res.json(result);
}
async function updateCompanySettings(req, res) {
  const companyId = req.companyId;
  const { name, settings, whatsappProvider } = req.body;
  const c = await CompanyModel.findOneAndUpdate(
    { _id: new Types.ObjectId(companyId), deletedAt: null },
    {
      $set: {
        ...name ? { name } : {},
        ...settings ? { settings } : {},
        ...whatsappProvider ? { whatsappProvider } : {}
      }
    },
    { new: true }
  );
  if (!c) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(c);
}
export {
  getWalletCtrl,
  listTransactions,
  updateCompanySettings
};
