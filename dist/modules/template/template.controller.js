import { Types } from "mongoose";
import { TemplateModel } from "./template.model.js";
async function listTemplates(req, res) {
  const companyId = req.companyId;
  const rows = await TemplateModel.find({
    companyId: new Types.ObjectId(companyId),
    deletedAt: null
  }).lean();
  res.json(rows);
}
async function createTemplate(req, res) {
  const companyId = req.companyId;
  const { name, body, language, imageUrl } = req.body;
  const t = await TemplateModel.create({
    companyId: new Types.ObjectId(companyId),
    name,
    body,
    language,
    ...imageUrl ? { imageUrl } : {}
  });
  res.status(201).json(t);
}
async function updateTemplate(req, res) {
  const companyId = req.companyId;
  const { id } = req.params;
  const body = req.body;
  const setDoc = {};
  if (body.name !== void 0) setDoc.name = body.name;
  if (body.body !== void 0) setDoc.body = body.body;
  if (body.language !== void 0) setDoc.language = body.language;
  const unsetDoc = {};
  if (body.imageUrl !== void 0) {
    if (body.imageUrl === null || body.imageUrl === "") {
      unsetDoc.imageUrl = 1;
    } else {
      setDoc.imageUrl = body.imageUrl;
    }
  }
  const update = {};
  if (Object.keys(setDoc).length) update.$set = setDoc;
  if (Object.keys(unsetDoc).length) update.$unset = unsetDoc;
  if (!Object.keys(update).length) {
    const existing = await TemplateModel.findOne({
      _id: id,
      companyId: new Types.ObjectId(companyId),
      deletedAt: null
    });
    if (!existing) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(existing);
    return;
  }
  const t = await TemplateModel.findOneAndUpdate(
    { _id: id, companyId: new Types.ObjectId(companyId), deletedAt: null },
    update,
    { new: true }
  );
  if (!t) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(t);
}
async function deleteTemplate(req, res) {
  const companyId = req.companyId;
  const { id } = req.params;
  await TemplateModel.updateOne(
    { _id: id, companyId: new Types.ObjectId(companyId) },
    { $set: { deletedAt: /* @__PURE__ */ new Date() } }
  );
  res.json({ ok: true });
}
export {
  createTemplate,
  deleteTemplate,
  listTemplates,
  updateTemplate
};
