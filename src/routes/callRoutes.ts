import { Router } from 'express';
import { initiateCall, listCalls } from '../controllers/callController';
import { authenticate } from '../middlewares/authMiddleware';

const router = Router();

router.use(authenticate);

router.post('/', initiateCall);
router.get('/', listCalls);

export default router;
