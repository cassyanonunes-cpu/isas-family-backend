import { Response } from 'express';
import { AuthRequest } from '../middlewares/authMiddleware';
import prisma from '../utils/prisma';

export const registerDevice = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { identifier, platform, pushToken, voipToken } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Não autorizado.' });
    }

    if (!identifier || !platform) {
      return res.status(400).json({ error: 'identifier e platform são obrigatórios.' });
    }

    // Procura se o dispositivo já existe para este usuário
    let device = await prisma.device.findFirst({
      where: { userId, identifier }
    });

    if (device) {
      // Atualiza
      device = await prisma.device.update({
        where: { id: device.id },
        data: {
          pushToken: pushToken || device.pushToken,
          voipToken: voipToken || device.voipToken,
          platform,
          isActive: true,
          lastAccess: new Date()
        }
      });
    } else {
      // Cria
      device = await prisma.device.create({
        data: {
          userId,
          identifier,
          platform,
          pushToken,
          voipToken,
          isActive: true
        }
      });
    }

    return res.status(200).json(device);
  } catch (error) {
    console.error('Erro em registerDevice', error);
    return res.status(500).json({ error: 'Erro ao registrar dispositivo.' });
  }
};

export const unregisterDevice = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { identifier } = req.body;

    if (!userId || !identifier) {
      return res.status(400).json({ error: 'Dados inválidos.' });
    }

    await prisma.device.updateMany({
      where: { userId, identifier },
      data: { isActive: false, pushToken: null, voipToken: null }
    });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Erro em unregisterDevice', error);
    return res.status(500).json({ error: 'Erro ao desregistrar dispositivo.' });
  }
};
