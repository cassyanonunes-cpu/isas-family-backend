import { Router } from 'express';
import { 
  createDirectConversation, 
  createGroupConversation, 
  sendMessage, 
  getMessages, 
  listConversations,
  updateGroupProfile,
  addGroupMember,
  removeGroupMember,
  uploadAttachment,
  downloadAttachment,
  markMessagesAsRead
} from '../controllers/chatController';
import { authenticate } from '../middlewares/authMiddleware';
import multer from 'multer';
import path from 'path';

// Multer temporário configurado para salvar na pasta 'temp'
const upload = multer({ dest: path.join(__dirname, '../../temp') });

const router = Router();

router.use(authenticate);

router.get('/conversations', listConversations);
router.post('/conversations/direct', createDirectConversation);
router.post('/conversations/group', createGroupConversation);

router.post('/conversations/:conversationId/messages', sendMessage);
router.post('/conversations/:conversationId/messages/upload', upload.single('file'), uploadAttachment);
router.get('/conversations/:conversationId/messages', getMessages);
router.post('/conversations/:conversationId/read', markMessagesAsRead);
router.get('/attachments/:attachmentId', downloadAttachment);

router.put('/conversations/group/:id/name', updateGroupProfile);
router.post('/conversations/group/:id/members', addGroupMember);
router.delete('/conversations/group/:id/members/:userId', removeGroupMember);

export default router;
