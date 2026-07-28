import { Server } from 'socket.io';
import { env } from '../config/env.js';
import { verifyAccessToken } from '../utils/jwt.js';
import { MembershipModel } from '../modules/company/membership.model.js';
import { Types } from 'mongoose';
let io = null;
export function initSocket(server) {
    io = new Server(server, {
        cors: { origin: env.FRONTEND_URL, credentials: true },
    });
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token;
            const companyId = socket.handshake.auth.companyId;
            if (!token || !companyId) {
                next(new Error('Unauthorized'));
                return;
            }
            const payload = verifyAccessToken(token);
            if (!payload.isSuperAdmin) {
                const m = await MembershipModel.findOne({
                    userId: new Types.ObjectId(payload.sub),
                    companyId: new Types.ObjectId(companyId),
                    deletedAt: null,
                }).lean();
                if (!m) {
                    next(new Error('Forbidden'));
                    return;
                }
            }
            socket.data.companyId = companyId;
            socket.data.userId = payload.sub;
            next();
        }
        catch {
            next(new Error('Unauthorized'));
        }
    });
    io.on('connection', (socket) => {
        const companyId = socket.data.companyId;
        void socket.join(`company:${companyId}`);
        socket.on('typing', (payload) => {
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
export function getIO() {
    if (!io)
        throw new Error('Socket not initialized');
    return io;
}
export function emitToCompany(companyId, event, data) {
    void getIO().to(`company:${companyId}`).emit(event, data);
}
