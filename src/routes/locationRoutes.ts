import { Router } from 'express';
import { updateLocation, getFamilyLocations, toggleSharing } from '../controllers/locationController';
import { authenticate } from '../middlewares/authMiddleware';

const router = Router();

router.use(authenticate);

router.post('/', updateLocation);
router.get('/', getFamilyLocations);
router.post('/toggle', toggleSharing);

export default router;
