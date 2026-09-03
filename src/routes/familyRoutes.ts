import { Router } from 'express';
import { getMembers, getFamilyInfo } from '../controllers/familyController';
import { authenticate } from '../middlewares/authMiddleware';

const router = Router();

// Todas as rotas de família requerem autenticação
router.use(authenticate);

router.get('/', getFamilyInfo);
router.get('/members', getMembers);

export default router;
