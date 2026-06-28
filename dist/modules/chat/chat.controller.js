import { listChats, listMessages, openChatWithContact, sendOutboundChatMessage } from "./chat.service.js";
async function getChats(req, res) {
  const companyId = req.companyId;
  const rows = await listChats(companyId);
  res.json(rows);
}
async function createChat(req, res) {
  const companyId = req.companyId;
  const { contactId, whatsappNumberId } = req.body;
  try {
    const chat = await openChatWithContact({ companyId, contactId, whatsappNumberId });
    res.status(201).json(chat);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "Could not open chat" });
  }
}
async function getMessages(req, res) {
  const companyId = req.companyId;
  const { chatId } = req.params;
  if (!chatId) {
    res.status(400).json({ error: "Missing chat id" });
    return;
  }
  const q = req.query;
  const limit = typeof q.limit === "string" ? Number(q.limit) : void 0;
  const before = typeof q.before === "string" ? q.before : void 0;
  const rows = await listMessages(companyId, chatId, { limit, before });
  res.json(rows);
}
async function postMessage(req, res) {
  const companyId = req.companyId;
  const userId = req.user?.sub;
  const { chatId } = req.params;
  const { body } = req.body;
  if (!chatId) {
    res.status(400).json({ error: "Missing chat id" });
    return;
  }
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  try {
    const msg = await sendOutboundChatMessage({ companyId, userId, chatId, body });
    res.status(201).json(msg);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : "send failed" });
  }
}
export {
  createChat,
  getChats,
  getMessages,
  postMessage
};
