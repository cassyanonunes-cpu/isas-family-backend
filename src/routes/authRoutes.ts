import { Router } from 'express';
import { login, refresh, logout, inviteLogin } from '../controllers/AuthController';

const router = Router();

router.post('/login', login);
router.post('/invite-login', inviteLogin);
router.post('/refresh', refresh);
router.post('/logout', logout);

export default router;
