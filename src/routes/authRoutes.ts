import { Router } from 'express';
import { login, refresh, logout, inviteLogin, nameLogin } from '../controllers/authController';

const router = Router();

router.post('/login', login);
router.post('/invite-login', inviteLogin);
router.post('/name-login', nameLogin);
router.post('/refresh', refresh);
router.post('/logout', logout);

export default router;
