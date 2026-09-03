import { Router } from 'express';
import { registerDevice, unregisterDevice } from '../controllers/deviceController';
import { authenticate } from '../middlewares/authMiddleware';

const router = Router();

router.use(authenticate);

router.post('/register', registerDevice);
router.post('/unregister', unregisterDevice);

export default router;
