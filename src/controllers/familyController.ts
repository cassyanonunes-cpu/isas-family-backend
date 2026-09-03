import { Response } from 'express';
import { AuthRequest } from '../middlewares/authMiddleware';
import prisma from '../utils/prisma';

export const getMembers = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  
  if (!user) {
    res.status(401).json({ error: 'Não autorizado' });
    return;
  }

  try {
    const members = await prisma.user.findMany({
      where: { familyId: user.familyId },
      select: {
        id: true,
        name: true,
        displayName: true,
        role: true,
        status: true,
        avatarUrl: true,
        birthday: true,
        createdAt: true,
        updatedAt: true
      }
    });

    res.json({ members });
  } catch (error) {
    console.error('Erro ao listar membros:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
};

export const getFamilyInfo = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  
  if (!user) {
    res.status(401).json({ error: 'Não autorizado' });
    return;
  }

  try {
    const family = await prisma.family.findUnique({
      where: { id: user.familyId },
      include: {
        _count: {
          select: { users: true }
        }
      }
    });

    if (!family) {
      res.status(404).json({ error: 'Família não encontrada' });
      return;
    }

    res.json({ family });
  } catch (error) {
    console.error('Erro ao obter informações da família:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
};
