import { Response } from 'express';
import { AuthRequest } from '../middlewares/authMiddleware';
import prisma from '../utils/prisma';
import { socketService } from '../sockets/socketManager';

export const updateProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  const { name, displayName, status, birthday, notificationPreview, themePreference } = req.body;

  if (!user) {
    res.status(401).json({ error: 'Não autorizado' });
    return;
  }

  try {
    const updatedUser = await prisma.user.update({
      where: { id: user.userId },
      data: {
        name,
        displayName,
        status,
        birthday: birthday ? new Date(birthday) : null,
        notificationPreview,
        themePreference
      },
      select: {
        id: true, name: true, displayName: true, email: true, role: true, 
        familyId: true, avatarUrl: true, isSharingLocation: true,
        status: true, birthday: true, notificationPreview: true, themePreference: true,
        isOnline: true, lastSeen: true
      }
    });

    res.status(200).json({ user: updatedUser });
  } catch (error) {
    console.error('Erro ao atualizar perfil:', error);
    res.status(500).json({ error: 'Erro ao atualizar perfil' });
  }
};
