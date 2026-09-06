import { Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../utils/prisma';
import { hashPassword } from '../utils/auth';
import { AuthRequest } from '../middlewares/authMiddleware';

export const createInvitation = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  
  if (!user || user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Apenas administradores podem criar convites' });
    return;
  }

  try {
    // Gera um código alfanumérico curto de 6 caracteres (mais fácil de digitar e copiar)
    const token = crypto.randomBytes(3).toString('hex').toUpperCase();
    const daysToExpire = parseInt(process.env.INVITE_EXPIRATION_DAYS || '7', 10);
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + daysToExpire);

    const invitation = await prisma.invitation.create({
      data: {
        familyId: user.familyId,
        createdBy: user.userId,
        code: token,
        status: 'PENDING',
        expiresAt
      }
    });

    res.status(201).json({
      message: 'Convite criado com sucesso',
      invitation: {
        id: invitation.id,
        code: invitation.code,
        expiresAt: invitation.expiresAt,
        status: invitation.status,
        link: `isasfamily://invite/${invitation.code}`
      }
    });
  } catch (error) {
    console.error('Erro ao criar convite:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
};

export const listInvitations = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  
  if (!user || user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Acesso negado' });
    return;
  }

  try {
    const invitations = await prisma.invitation.findMany({
      where: { familyId: user.familyId },
      orderBy: { createdAt: 'desc' }
    });

    res.json({ invitations });
  } catch (error) {
    console.error('Erro ao listar convites:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
};

export const cancelInvitation = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  const id = req.params['id'] as string;
  
  if (!user || user.role !== 'ADMIN') {
    res.status(403).json({ error: 'Acesso negado' });
    return;
  }

  try {
    const invitation = await prisma.invitation.findFirst({
      where: { id, familyId: user.familyId }
    });

    if (!invitation) {
      res.status(404).json({ error: 'Convite não encontrado' });
      return;
    }

    if (invitation.status !== 'PENDING') {
      res.status(400).json({ error: `Não é possível cancelar um convite com status ${invitation.status}` });
      return;
    }

    await prisma.invitation.update({
      where: { id },
      data: { status: 'CANCELLED' }
    });

    res.json({ message: 'Convite cancelado com sucesso' });
  } catch (error) {
    console.error('Erro ao cancelar convite:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
};

export const validateInvitation = async (req: Request, res: Response): Promise<void> => {
  const code = req.params['code'] as string;

  try {
    const invitation = await prisma.invitation.findUnique({
      where: { code }
    });

    if (!invitation) {
      res.status(404).json({ valid: false, error: 'Convite inválido' });
      return;
    }

    // Buscar o nome da família separadamente
    const family = await prisma.family.findUnique({ where: { id: invitation.familyId } });
    if (!family) {
      res.status(404).json({ valid: false, error: 'Família não encontrada' });
      return;
    }

    if (invitation.status !== 'PENDING' || invitation.expiresAt < new Date()) {
      res.status(400).json({ 
        valid: false, 
        error: invitation.status === 'CANCELLED' ? 'Convite cancelado' : 'Convite expirado ou já utilizado' 
      });
      return;
    }

    res.json({
      valid: true,
      familyName: family.name,
      expiresAt: invitation.expiresAt
    });
  } catch (error) {
    console.error('Erro ao validar convite:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
};

export const acceptInvitation = async (req: Request, res: Response): Promise<void> => {
  const code = req.params['code'] as string;
  const { name, displayName, email, password } = req.body;

  if (!name || !displayName || !email || !password) {
    res.status(400).json({ error: 'Dados incompletos para criação da conta' });
    return;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Validar convite
      const invitation = await tx.invitation.findUnique({
        where: { code: code }
      });

      if (!invitation) {
        throw new Error('INVITATION_NOT_FOUND');
      }

      if (invitation.status !== 'PENDING') {
        throw new Error(`INVITATION_${invitation.status}`);
      }

      if (invitation.expiresAt < new Date()) {
        // Marca como expirado no banco já que passou do tempo
        await tx.invitation.update({
          where: { id: invitation.id },
          data: { status: 'EXPIRED' }
        });
        throw new Error('INVITATION_EXPIRED');
      }

      // 2. Verificar se o e-mail já está cadastrado
      const existingUser = await tx.user.findUnique({
        where: { email }
      });

      if (existingUser) {
        throw new Error('EMAIL_ALREADY_EXISTS');
      }

      // 3. Criar usuário associado à família do convite
      const hashedPassword = await hashPassword(password);
      
      const newUser = await tx.user.create({
        data: {
          familyId: invitation.familyId,
          role: 'MEMBER', // Forçado como membro, ignora qlqr coisa enviada
          name,
          displayName,
          email,
          password: hashedPassword,
        }
      });

      // 4. Marcar convite como ACCEPTED
      await tx.invitation.update({
        where: { id: invitation.id },
        data: {
          status: 'ACCEPTED',
          usedById: newUser.id,
          usedAt: new Date()
        }
      });

      return newUser;
    });

    const { password: _, ...userWithoutPassword } = result;

    res.status(201).json({
      message: 'Conta criada com sucesso e adicionada à família',
      user: userWithoutPassword
    });

  } catch (error: any) {
    if (error.message === 'INVITATION_NOT_FOUND') {
      res.status(404).json({ error: 'Convite inválido' });
    } else if (error.message.startsWith('INVITATION_')) {
      res.status(400).json({ error: 'Convite indisponível para uso' });
    } else if (error.message === 'EMAIL_ALREADY_EXISTS') {
      res.status(409).json({ error: 'E-mail já está em uso' });
    } else {
      console.error('Erro ao aceitar convite:', error);
      res.status(500).json({ error: 'Erro interno no servidor' });
    }
  }
};
