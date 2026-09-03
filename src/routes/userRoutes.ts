import { Router } from 'express';
import { updateProfile } from '../controllers/userController';
import { authenticate } from '../middlewares/authMiddleware';

const router = Router();

router.use(authenticate);

router.put('/me', updateProfile);

export default router;
