import express from 'express';
import cors from 'cors';
import authRoutes from './routes/authRoutes';
import familyRoutes from './routes/familyRoutes';
import invitationRoutes from './routes/invitationRoutes';
import chatRoutes from './routes/chatRoutes';
import locationRoutes from './routes/locationRoutes';
import callRoutes from './routes/callRoutes';
import deviceRoutes from './routes/deviceRoutes';
import userRoutes from './routes/userRoutes';

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/family', familyRoutes);
app.use('/api/invitations', invitationRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/location', locationRoutes);
app.use('/api/calls', callRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/users', userRoutes);

// Rota de saúde para verificação simples
app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

export default app;
