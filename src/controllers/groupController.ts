import { Response } from 'express';
import { AuthRequest } from '../middlewares/authMiddleware';
import prisma from '../utils/prisma';
import { socketService } from '../sockets/socketManager';

export const createGroup = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  const { name, members } = req.body; // members = array de userIds

  if (!user || !name || !Array.isArray(members) || members.length === 0) {
    res.status(400).json({ error: 'Dados inválidos para criar grupo' });
    return;
  }

  try {
    // Valida se todos pertencem à família
    const familyUsers = await prisma.user.findMany({
      where: {
        id: { in: members },
        familyId: user.familyId
      }
    });

    if (familyUsers.length !== members.length) {
      res.status(403).json({ error: 'Um ou mais usuários não pertencem à sua família' });
      return;
    }

    const allMembers = Array.from(new Set([user.userId, ...members]));

    const newGroup = await prisma.conversation.create({
      data: {
        familyId: user.familyId,
        type: 'GROUP',
        name,
        members: {
          create: allMembers.map(id => ({
            userId: id,
            role: id === user.userId ? 'ADMIN' : 'MEMBER'
          }))
        }
      },
      include: {
        members: { include: { user: { select: { id: true, name: true, displayName: true, avatarUrl: true } } } }
      }
    });

    // Notificar membros via socket
    allMembers.forEach(memberId => {
      // emitConversationUpdated ou outro evento se necessário
    });

    res.status(201).json({ conversation: newGroup });
  } catch (error) {
    console.error('Erro ao criar grupo:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
};

export const updateGroup = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  const id = req.params['id'] as string;
  const { name, description } = req.body as { name?: string; description?: string };

  if (!user) {
    res.status(401).json({ error: 'Não autorizado' });
    return;
  }

  try {
    const membership = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: id, userId: user.userId } }
    });

    if (!membership || membership.role !== 'ADMIN') {
      res.status(403).json({ error: 'Apenas administradores podem editar o grupo' });
      return;
    }

    const updatedGroup = await prisma.conversation.update({
      where: { id },
      data: { name, description }
    });

    res.status(200).json({ conversation: updatedGroup });
  } catch (error) {
    console.error('Erro ao atualizar grupo:', error);
    res.status(500).json({ error: 'Erro ao atualizar grupo' });
  }
};
