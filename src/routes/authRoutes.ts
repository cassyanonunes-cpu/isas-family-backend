import { Router } from 'express';
import { login, refresh, logout, inviteLogin } from '../controllers/authController';

const router = Router();

import prisma from '../utils/prisma';
router.get('/seed', async (req, res) => {
  try {
    const family = await prisma.family.create({ data: { name: 'Sua Familia' } });
    const invite = await prisma.invitation.create({
      data: { familyId: family.id, createdBy: 'SYSTEM', code: 'FE33E5', expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), status: 'PENDING' }
    });
    res.json({ message: 'Convite criado com sucesso!', code: invite.code });
  } catch (error: any) {
    res.json({ error: error.message });
  }
});

router.post('/login', login);
router.post('/invite-login', inviteLogin);
router.post('/refresh', refresh);
router.post('/logout', logout);

export default router;
