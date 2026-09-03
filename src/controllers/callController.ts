import { Response } from 'express';
import { AuthRequest } from '../middlewares/authMiddleware';
import prisma from '../utils/prisma';
import { socketService } from '../sockets/socketManager';
import { pushService } from '../services/pushService';

export const initiateCall = async (req: AuthRequest, res: Response) => {
  try {
    const { calleeId, type } = req.body;
    const userId = req.user?.userId;
    const familyId = req.user?.familyId;

    if (!userId || !familyId) {
      return res.status(401).json({ error: 'Não autorizado.' });
    }

    if (!calleeId || !['VOICE', 'VIDEO'].includes(type)) {
      return res.status(400).json({ error: 'Dados inválidos.' });
    }

    // Valida se o callee pertence à mesma família
    const callee = await prisma.user.findUnique({
      where: { id: calleeId }
    });

    if (!callee || callee.familyId !== familyId) {
      return res.status(403).json({ error: 'Usuário não encontrado na família.' });
    }

    // Cria a chamada
    const call = await prisma.call.create({
      data: {
        familyId,
        callerId: userId,
        calleeId,
        type,
        status: 'RINGING'
      },
      include: {
        caller: {
          select: { id: true, name: true, displayName: true, avatarUrl: true }
        }
      }
    });

    // Sinaliza o callee via socket
    socketService.emitToUser(calleeId, 'call:incoming', call);

    // Envia VoIP Push (que irá acordar o aparelho se estiver em background/lock screen)
    await pushService.sendVoipPush(calleeId, call.id, call.caller.displayName, type);

    // Timeout de 45 segundos para resposta
    setTimeout(async () => {
      const currentCall = await prisma.call.findUnique({ where: { id: call.id } });
      if (currentCall && currentCall.status === 'RINGING') {
        await prisma.call.update({
          where: { id: call.id },
          data: { status: 'MISSED', endedAt: new Date() }
        });
        socketService.emitToUser(call.callerId, 'call:missed', { callId: call.id });
        socketService.emitToUser(call.calleeId, 'call:missed', { callId: call.id });
      }
    }, 45000);

    return res.status(201).json(call);
  } catch (error) {
    console.error('Erro em initiateCall', error);
    return res.status(500).json({ error: 'Erro interno ao iniciar chamada.' });
  }
};

export const listCalls = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const familyId = req.user?.familyId;

    if (!userId || !familyId) {
      return res.status(401).json({ error: 'Não autorizado.' });
    }

    const calls = await prisma.call.findMany({
      where: {
        familyId,
        OR: [
          { callerId: userId },
          { calleeId: userId }
        ]
      },
      include: {
        caller: {
          select: { id: true, name: true, displayName: true, avatarUrl: true }
        },
        callee: {
          select: { id: true, name: true, displayName: true, avatarUrl: true }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 50
    });

    return res.status(200).json(calls);
  } catch (error) {
    console.error('Erro em listCalls', error);
    return res.status(500).json({ error: 'Erro ao listar chamadas.' });
  }
};
