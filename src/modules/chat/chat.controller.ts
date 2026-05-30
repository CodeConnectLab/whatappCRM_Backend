import type { Request, Response } from 'express';
import { listChats, listMessages, openChatWithContact, sendOutboundChatMessage } from './chat.service.js';

export async function getChats(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const rows = await listChats(companyId);
  res.json(rows);
}

export async function createChat(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const { contactId, whatsappNumberId } = req.body as {
    contactId: string;
    whatsappNumberId?: string;
  };
  try {
    const chat = await openChatWithContact({ companyId, contactId, whatsappNumberId });
    res.status(201).json(chat);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'Could not open chat' });
  }
}

export async function getMessages(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const { chatId } = req.params as { chatId: string };
  if (!chatId) {
    res.status(400).json({ error: 'Missing chat id' });
    return;
  }
  const q = req.query as Record<string, unknown>;
  const limit = typeof q.limit === 'string' ? Number(q.limit) : undefined;
  const before = typeof q.before === 'string' ? q.before : undefined;
  const rows = await listMessages(companyId, chatId, { limit, before });
  res.json(rows);
}

export async function postMessage(req: Request, res: Response): Promise<void> {
  const companyId = req.companyId!;
  const userId = req.user?.sub;
  const { chatId } = req.params as { chatId: string };
  const { body } = req.body as { body: string };
  if (!chatId) {
    res.status(400).json({ error: 'Missing chat id' });
    return;
  }
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const msg = await sendOutboundChatMessage({ companyId, userId, chatId, body });
    res.status(201).json(msg);
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'send failed' });
  }
}
