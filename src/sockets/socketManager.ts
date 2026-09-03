import { Server, Socket } from 'socket.io';
import { verifyAccessToken } from '../utils/auth';
import prisma from '../utils/prisma';
import http from 'http';

let io: Server;

export const initSocket = (server: http.Server) => {
  io = new Server(server, {
    cors: { origin: '*' }
  });

  // Autenticação no handshake
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) return next(new Error('Token não fornecido'));

      const payload = verifyAccessToken(token);
      
      // Associar dados ao socket
      (socket as any).user = payload;
      
      next();
    } catch (err) {
      next(new Error('Autenticação inválida'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = (socket as any).user;
    console.log(`[Socket] Conectado: ${user.userId}`);

    // Entrar na sala pessoal e na sala da família
    socket.join(`user:${user.userId}`);
    socket.join(`family:${user.familyId}`);

    // Presença: Marcar como online
    prisma.user.update({
      where: { id: user.userId },
      data: { isOnline: true }
    }).then(() => {
      io.to(`family:${user.familyId}`).emit('user:presence', { userId: user.userId, isOnline: true });
    }).catch(err => console.error(err));

    // Cliente pede para entrar na sala da conversa
    socket.on('join_conversation', async (conversationId: string) => {
      // Validar no banco se ele pertence a esta conversa
      const membership = await prisma.conversationMember.findUnique({
        where: { conversationId_userId: { conversationId, userId: user.userId } }
      });

      if (membership) {
        socket.join(`conversation:${conversationId}`);
        console.log(`[Socket] User ${user.userId} entrou na sala conversation:${conversationId}`);
      } else {
        socket.emit('error', { message: 'Não autorizado a entrar nesta conversa' });
      }
    });

    socket.on('leave_conversation', (conversationId: string) => {
      socket.leave(`conversation:${conversationId}`);
    });

    socket.on('chat:typing', (payload: { conversationId: string }) => {
      // Repassa o evento de typing para os outros membros da sala
      socket.to(`conversation:${payload.conversationId}`).emit('chat:typing', {
        conversationId: payload.conversationId,
        userId: user.userId
      });
    });

    socket.on('disconnect', () => {
      console.log(`[Socket] Desconectado: ${user.userId}`);
      prisma.user.update({
        where: { id: user.userId },
        data: { isOnline: false, lastSeen: new Date() }
      }).then(() => {
        io.to(`family:${user.familyId}`).emit('user:presence', { userId: user.userId, isOnline: false, lastSeen: new Date() });
      }).catch(err => console.error(err));
    });

    // --- SIGNALING WEBRTC ---
    const validateCallAccess = async (callId: string, toUserId: string) => {
      const call = await prisma.call.findUnique({ where: { id: callId } });
      if (!call) return false;
      if (call.familyId !== user.familyId) return false;
      if (call.callerId !== user.userId && call.calleeId !== user.userId) return false;
      if (call.callerId !== toUserId && call.calleeId !== toUserId) return false;
      return true;
    };

    socket.on('call:accept', async (payload: { callId: string, to: string }) => {
      if (await validateCallAccess(payload.callId, payload.to)) {
        await prisma.call.update({
          where: { id: payload.callId },
          data: { status: 'ANSWERED', answeredAt: new Date() }
        });
        io.to(`user:${payload.to}`).emit('call:accept', { callId: payload.callId, from: user.userId });
      }
    });

    socket.on('call:decline', async (payload: { callId: string, to: string }) => {
      if (await validateCallAccess(payload.callId, payload.to)) {
        await prisma.call.update({
          where: { id: payload.callId },
          data: { status: 'DECLINED', endedAt: new Date() }
        });
        io.to(`user:${payload.to}`).emit('call:decline', { callId: payload.callId, from: user.userId });
      }
    });

    socket.on('call:end', async (payload: { callId: string, to: string }) => {
      if (await validateCallAccess(payload.callId, payload.to)) {
        await prisma.call.update({
          where: { id: payload.callId },
          data: { status: 'ENDED', endedAt: new Date() }
        });
        io.to(`user:${payload.to}`).emit('call:end', { callId: payload.callId, from: user.userId });
      }
    });

    socket.on('call:offer', async (payload: { callId: string, to: string, offer: any }) => {
      if (await validateCallAccess(payload.callId, payload.to)) {
        io.to(`user:${payload.to}`).emit('call:offer', { callId: payload.callId, offer: payload.offer, from: user.userId });
      }
    });

    socket.on('call:answer', async (payload: { callId: string, to: string, answer: any }) => {
      if (await validateCallAccess(payload.callId, payload.to)) {
        io.to(`user:${payload.to}`).emit('call:answer', { callId: payload.callId, answer: payload.answer, from: user.userId });
      }
    });

    socket.on('call:ice-candidate', async (payload: { callId: string, to: string, candidate: any }) => {
      if (await validateCallAccess(payload.callId, payload.to)) {
        io.to(`user:${payload.to}`).emit('call:ice-candidate', { callId: payload.callId, candidate: payload.candidate, from: user.userId });
      }
    });

  });
};

export const emitNewMessage = (conversationId: string, message: any) => {
  if (io) {
    io.to(`conversation:${conversationId}`).emit('message:new', message);
  }
};

export const emitToConversation = (conversationId: string, eventName: string, data: any) => {
  if (io) {
    io.to(`conversation:${conversationId}`).emit(eventName, data);
  }
};

export const emitConversationUpdated = (conversationId: string, message: any) => {
  if (io) {
    // Idealmente, deveríamos emitir para cada usuário membro, 
    // mas por simplicidade podemos emitir para a room da conversa
    // ou para os usuários logados.
    // O cliente vai escutar isso na lista principal de conversas.
    io.to(`conversation:${conversationId}`).emit('conversation:updated', {
      conversationId,
      lastMessage: message
    });
  }
};

export const emitLocationUpdated = (familyId: string, locationData: any) => {
  if (io) {
    io.to(`family:${familyId}`).emit('location:updated', locationData);
  }
};

export const socketService = {
  emitToUser: (userId: string, event: string, data: any) => {
    if (io) {
      io.to(`user:${userId}`).emit(event, data);
    }
  }
};
