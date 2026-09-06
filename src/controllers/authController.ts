import { Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../utils/prisma';
import { comparePassword, generateAccessToken, generateRefreshToken, verifyRefreshToken, TokenPayload, hashPassword } from '../utils/auth';

export const login = async (req: Request, res: Response): Promise<void> => {
  const { email, password, platform, identifier } = req.body;

  if (!email || !password || !platform || !identifier) {
    res.status(400).json({ error: 'Dados incompletos para login (email, password, platform, identifier)' });
    return;
  }

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      res.status(401).json({ error: 'Credenciais inválidas' });
      return;
    }

    const isValidPassword = await comparePassword(password, user.password);
    if (!isValidPassword) {
      res.status(401).json({ error: 'Credenciais inválidas' });
      return;
    }

    // Gerar tokens
    const payload: TokenPayload = {
      userId: user.id,
      familyId: user.familyId,
      role: user.role
    };
    
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    // Registrar ou atualizar dispositivo e associar refresh token
    // Como simplificação, criamos um novo refresh token e removemos o antigo para este identifier
    
    // Primeiro, encontra o device
    let device = await prisma.device.findFirst({
      where: { userId: user.id, identifier }
    });

    if (!device) {
      device = await prisma.device.create({
        data: {
          userId: user.id,
          platform,
          identifier,
          lastAccess: new Date(),
          isActive: true
        }
      });
    } else {
      device = await prisma.device.update({
        where: { id: device.id },
        data: { lastAccess: new Date(), isActive: true }
      });
    }

    // Salvar o refresh token associado ao user
    await prisma.refreshToken.create({
      data: {
        userId: user.id,
        token: refreshToken,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 dias
      }
    });

    // Não retornar a senha
    const { password: _, ...userWithoutPassword } = user;

    res.json({
      accessToken,
      refreshToken,
      user: userWithoutPassword
    });
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
};

export const refresh = async (req: Request, res: Response): Promise<void> => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    res.status(400).json({ error: 'Refresh token não fornecido' });
    return;
  }

  try {
    const payload = verifyRefreshToken(refreshToken);
    
    // Verificar se o token existe no banco
    const dbToken = await prisma.refreshToken.findUnique({
      where: { token: refreshToken }
    });

    if (!dbToken) {
      res.status(401).json({ error: 'Refresh token inválido ou revogado' });
      return;
    }

    // Gerar novo access token
    const newPayload: TokenPayload = {
      userId: payload.userId,
      familyId: payload.familyId,
      role: payload.role
    };

    const newAccessToken = generateAccessToken(newPayload);
    
    // Opcional: Rotacionar o refresh token
    // Aqui manteremos o mesmo para simplificar, a menos que esteja expirado
    
    res.json({ accessToken: newAccessToken });
  } catch (error) {
    res.status(401).json({ error: 'Refresh token inválido ou expirado' });
  }
};

export const logout = async (req: Request, res: Response): Promise<void> => {
  const { refreshToken } = req.body;

  if (!refreshToken) {
    res.status(400).json({ error: 'Refresh token não fornecido' });
    return;
  }

  try {
    // Remover o refresh token do banco
    await prisma.refreshToken.deleteMany({
      where: { token: refreshToken }
    });

    res.json({ message: 'Logout efetuado com sucesso' });
  } catch (error) {
    console.error('Erro no logout:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
};

export const inviteLogin = async (req: Request, res: Response): Promise<void> => {
  const { code, name, platform, identifier } = req.body;

  if (!code || !name || !platform || !identifier) {
    res.status(400).json({ error: 'Dados incompletos para entrar (code, name, platform, identifier)' });
    return;
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // 1. Validar convite
      const invitation = await tx.invitation.findUnique({
        where: { code }
      });

      if (!invitation) throw new Error('INVITATION_NOT_FOUND');
      if (invitation.status !== 'PENDING') throw new Error(`INVITATION_${invitation.status}`);
      if (invitation.expiresAt < new Date()) {
        await tx.invitation.update({
          where: { id: invitation.id },
          data: { status: 'EXPIRED' }
        });
        throw new Error('INVITATION_EXPIRED');
      }

      // 2. Auto-gerar email e senha para o novo usuário
      const generatedEmail = `${crypto.randomUUID()}@isasfamily.local`;
      const generatedPassword = crypto.randomUUID();
      const hashedPassword = await hashPassword(generatedPassword);
      
      const newUser = await tx.user.create({
        data: {
          familyId: invitation.familyId,
          role: 'ADMIN',
          name,
          displayName: name,
          email: generatedEmail,
          password: hashedPassword,
        }
      });

      // 3. Marcar convite como ACCEPTED
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

    // 4. Autenticar usuário
    const payload: TokenPayload = {
      userId: result.id,
      familyId: result.familyId,
      role: result.role
    };
    
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    let device = await prisma.device.findFirst({
      where: { userId: result.id, identifier }
    });

    if (!device) {
      device = await prisma.device.create({
        data: {
          userId: result.id,
          platform,
          identifier,
          lastAccess: new Date(),
          isActive: true
        }
      });
    } else {
      device = await prisma.device.update({
        where: { id: device.id },
        data: { lastAccess: new Date(), isActive: true }
      });
    }

    await prisma.refreshToken.create({
      data: {
        userId: result.id,
        token: refreshToken,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      }
    });

    const { password: _, ...userWithoutPassword } = result;

    res.json({
      accessToken,
      refreshToken,
      user: userWithoutPassword
    });

  } catch (error: any) {
    console.error('Erro no login por convite:', error);
    if (error.message === 'INVITATION_NOT_FOUND') {
      res.status(404).json({ error: 'Convite inválido' });
    } else if (error.message.startsWith('INVITATION_')) {
      res.status(400).json({ error: 'Convite indisponível ou expirado' });
    } else {
      res.status(500).json({ error: 'Erro interno no servidor' });
    }
  }
};

export const nameLogin = async (req: Request, res: Response): Promise<void> => {
  const { name, platform, identifier } = req.body;

  if (!name || !platform || !identifier) {
    res.status(400).json({ error: 'Dados incompletos para entrar (name, platform, identifier)' });
    return;
  }

  const allowedNames = ['Cassyano', 'Isadora', 'Isabella'];
  const formattedName = name.trim();
  const lowerNames = allowedNames.map(n => n.toLowerCase());

  if (!lowerNames.includes(formattedName.toLowerCase())) {
    res.status(401).json({ error: 'Nome não autorizado para acesso à família.' });
    return;
  }

  // Encontra o nome original exato com a capitulação correta
  const exactName = allowedNames[lowerNames.indexOf(formattedName.toLowerCase())];

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Procura a primeira família do banco
      let family = await tx.family.findFirst();
      if (!family) {
          // Se não existir, cria a família base
          family = await tx.family.create({
              data: { name: 'Isas Family' }
          });
      }

      let user = await tx.user.findFirst({
        where: { displayName: exactName }
      });

      if (!user) {
        const generatedEmail = `${exactName.toLowerCase()}@isasfamily.local`;
        const generatedPassword = crypto.randomUUID();
        const hashedPassword = await hashPassword(generatedPassword);
        
        user = await tx.user.create({
          data: {
            familyId: family.id,
            role: exactName === 'Cassyano' ? 'ADMIN' : 'MEMBER',
            name: exactName,
            displayName: exactName,
            email: generatedEmail,
            password: hashedPassword,
          }
        });
      }

      return user;
    });

    const payload: TokenPayload = {
      userId: result.id,
      familyId: result.familyId,
      role: result.role
    };
    
    const accessToken = generateAccessToken(payload);
    const refreshToken = generateRefreshToken(payload);

    let device = await prisma.device.findFirst({
      where: { userId: result.id, identifier }
    });

    if (!device) {
      device = await prisma.device.create({
        data: {
          userId: result.id,
          platform,
          identifier,
          lastAccess: new Date(),
          isActive: true
        }
      });
    } else {
      device = await prisma.device.update({
        where: { id: device.id },
        data: { lastAccess: new Date(), isActive: true }
      });
    }

    await prisma.refreshToken.create({
      data: {
        userId: result.id,
        token: refreshToken,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
      }
    });

    const { password: _, ...userWithoutPassword } = result;

    res.json({
      accessToken,
      refreshToken,
      user: userWithoutPassword
    });

  } catch (error: any) {
    console.error('Erro no nameLogin:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
};
