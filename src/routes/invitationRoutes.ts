import { Router } from 'express';
import { 
  createInvitation, 
  listInvitations, 
  cancelInvitation, 
  validateInvitation, 
  acceptInvitation 
} from '../controllers/invitationController';
import { authenticate, requireAdmin } from '../middlewares/authMiddleware';

const router = Router();

// Rotas Públicas (para quem está recebendo o convite)
router.get('/validate/:code', validateInvitation);
router.post('/accept/:code', acceptInvitation);

// Rotas Autenticadas (Apenas Admin)
router.use(authenticate);
router.use(requireAdmin);

router.post('/', createInvitation);
router.get('/', listInvitations);
router.post('/:id/cancel', cancelInvitation);

export default router;
