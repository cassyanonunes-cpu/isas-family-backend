import { Response } from 'express';
import { AuthRequest } from '../middlewares/authMiddleware';
import prisma from '../utils/prisma';
import { emitLocationUpdated } from '../sockets/socketManager';

export const updateLocation = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  const { latitude, longitude, accuracy, batteryLevel } = req.body;

  if (!user) {
    res.status(401).json({ error: 'Não autorizado' });
    return;
  }

  if (latitude === undefined || longitude === undefined) {
    res.status(400).json({ error: 'Latitude e longitude são obrigatórios' });
    return;
  }

  try {
    // Verificar se o usuário está com o compartilhamento ativo
    const userData = await prisma.user.findUnique({ where: { id: user.userId } });

    if (!userData || !userData.isSharingLocation) {
      res.status(403).json({ error: 'Compartilhamento de localização desativado' });
      return;
    }

    const location = await prisma.location.upsert({
      where: { userId: user.userId },
      update: {
        latitude,
        longitude,
        accuracy,
        batteryLevel,
        familyId: user.familyId
      },
      create: {
        userId: user.userId,
        familyId: user.familyId,
        latitude,
        longitude,
        accuracy,
        batteryLevel
      }
    });

    // Notifica os membros da família logados via Socket.IO
    emitLocationUpdated(user.familyId, {
      userId: user.userId,
      latitude,
      longitude,
      accuracy,
      batteryLevel,
      updatedAt: location.updatedAt
    });

    res.json({ location });
  } catch (error) {
    console.error('Erro ao atualizar localização:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
};

export const getFamilyLocations = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;

  if (!user) {
    res.status(401).json({ error: 'Não autorizado' });
    return;
  }

  try {
    const locations = await prisma.location.findMany({
      where: { 
        familyId: user.familyId,
        user: { isSharingLocation: true }
      },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            avatarUrl: true
          }
        }
      }
    });

    res.json({ locations });
  } catch (error) {
    console.error('Erro ao buscar localizações:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
};

export const toggleSharing = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  const { isSharing } = req.body;

  if (!user || isSharing === undefined) {
    res.status(400).json({ error: 'Parâmetro isSharing obrigatório' });
    return;
  }

  try {
    await prisma.user.update({
      where: { id: user.userId },
      data: { isSharingLocation: isSharing }
    });

    res.json({ isSharing });
  } catch (error) {
    console.error('Erro ao alterar status de localização:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
};
