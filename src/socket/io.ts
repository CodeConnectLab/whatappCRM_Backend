import type { Server as HttpServer } from 'http';
import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { MembershipModel } from '../modules/company/membership.model.js';
import { UserModel } from '../modules/user/user.model.js';
import {
  getCompanySubscriptionLean,
  isExpired,
} from '../modules/subscription/subscription.service.js';
import { Types } from 'mongoose';

let io: Server | null = null;

export function initSocket(server: HttpServer): Server {
  io = new Server(server, {
    cors: { origin: env.FRONTEND_URL, credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token as string | undefined;
      const companyId = socket.handshake.auth.companyId as string | undefined;
      if (!token || !companyId) {
        next(new Error('Unauthorized'));
        return;
      }
      const payload = verifyAccessToken(token);
      if (!payload.isSuperAdmin) {
        const user = await UserModel.findById(payload.sub).select('tokenVersion deletedAt').lean();
        if (!user || user.deletedAt || (user.tokenVersion ?? 0) !== (payload.tv ?? 0)) {
          next(new Error('Unauthorized'));
          return;
        }
        const m = await MembershipModel.findOne({
          userId: new Types.ObjectId(payload.sub),
          companyId: new Types.ObjectId(companyId),
          deletedAt: null,
        }).lean();
        if (!m) {
          next(new Error('Forbidden'));
          return;
        }
        // An expired workspace gets no live feed either, matching the HTTP guard.
        const company = await getCompanySubscriptionLean(companyId);
        if (!company || isExpired(company)) {
          next(new Error('Subscription expired'));
          return;
        }
      }
      socket.data.companyId = companyId;
      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const companyId = socket.data.companyId as string;
    void socket.join(`company:${companyId}`);

    socket.on('typing', (payload: { chatId: string; typing: boolean }) => {
      socket.to(`company:${companyId}`).emit('typing', {
        chatId: payload.chatId,
        typing: payload.typing,
        userId: socket.data.userId,
      });
    });

    socket.on('presence:ping', () => {
      socket.to(`company:${companyId}`).emit('presence:online', {
        userId: socket.data.userId,
        at: Date.now(),
      });
    });
  });

  return io;
}

export function getIO(): Server {
  if (!io) throw new Error('Socket not initialized');
  return io;
}

export function emitToCompany(companyId: string, event: string, data: unknown): void {
  void getIO().to(`company:${companyId}`).emit(event, data);
}
