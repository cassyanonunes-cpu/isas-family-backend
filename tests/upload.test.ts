import request from 'supertest';
import app from '../src/app';
import prisma from '../src/utils/prisma';
import { generateAccessToken } from '../src/utils/auth';
import { createServer } from 'http';
import { initSocket } from '../src/sockets/socketManager';
import fs from 'fs';
import path from 'path';

let server: ReturnType<typeof createServer>;

beforeAll(async () => {
  server = createServer(app);
  initSocket(server);
});

afterAll(async () => {
  server.close();
  await prisma.$disconnect();
});

describe('Media Upload Endpoints', () => {
  let user1Token: string;
  let user2Token: string;
  let user3Token: string; // Outra família
  let familyAId: string;
  let familyBId: string;
  let conversationId: string;

  beforeEach(async () => {
    const ts = Date.now() + Math.random();
    const familyA = await prisma.family.create({ data: { name: 'Família A' } });
    familyAId = familyA.id;

    const user1 = await prisma.user.create({
      data: { familyId: familyAId, role: 'ADMIN', name: 'User 1', displayName: 'U1', email: `u1_${ts}@t.com`, password: 'hash' }
    });
    user1Token = generateAccessToken({ userId: user1.id, familyId: familyAId, role: 'ADMIN' });

    const user2 = await prisma.user.create({
      data: { familyId: familyAId, role: 'MEMBER', name: 'User 2', displayName: 'U2', email: `u2_${ts}@t.com`, password: 'hash' }
    });
    user2Token = generateAccessToken({ userId: user2.id, familyId: familyAId, role: 'MEMBER' });

    const familyB = await prisma.family.create({ data: { name: 'Família B' } });
    familyBId = familyB.id;

    const user3 = await prisma.user.create({
      data: { familyId: familyBId, role: 'ADMIN', name: 'User 3', displayName: 'U3', email: `u3_${ts}@t.com`, password: 'hash' }
    });
    user3Token = generateAccessToken({ userId: user3.id, familyId: familyBId, role: 'ADMIN' });

    // Cria uma conversa entre U1 e U2
    const conv = await prisma.conversation.create({
      data: {
        familyId: familyAId,
        type: 'DIRECT',
        members: {
          create: [{ userId: user1.id }, { userId: user2.id }]
        }
      }
    });
    conversationId = conv.id;
  });

  it('deve fazer upload de uma imagem com sucesso', async () => {
    // Cria um arquivo falso para upload
    const dummyPath = path.join(__dirname, 'dummy.jpg');
    fs.writeFileSync(dummyPath, 'fake image content');

    const res = await request(app)
      .post(`/api/chat/conversations/${conversationId}/messages/upload`)
      .set('Authorization', `Bearer ${user1Token}`)
      .field('type', 'IMAGE')
      .field('content', 'Olha essa foto!')
      .field('width', 800)
      .field('height', 600)
      .attach('file', dummyPath);

    fs.unlinkSync(dummyPath); // Limpa arquivo dummy

    expect(res.status).toBe(201);
    expect(res.body.message.type).toBe('IMAGE');
    expect(res.body.message.content).toBe('Olha essa foto!');
    expect(res.body.message.attachment.mimeType).toBe('image/jpeg');
    expect(res.body.message.attachment.width).toBe(800);
    expect(res.body.message.attachment.height).toBe(600);
  });

  it('NÃO deve permitir upload sem arquivo ou tipo', async () => {
    const res = await request(app)
      .post(`/api/chat/conversations/${conversationId}/messages/upload`)
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ type: 'IMAGE' }); // Sem file

    expect(res.status).toBe(400);
  });

  it('NÃO deve permitir que usuário fora da conversa envie arquivo', async () => {
    const dummyPath = path.join(__dirname, 'dummy.txt');
    fs.writeFileSync(dummyPath, 'fake');

    const res = await request(app)
      .post(`/api/chat/conversations/${conversationId}/messages/upload`)
      .set('Authorization', `Bearer ${user3Token}`)
      .field('type', 'DOCUMENT')
      .attach('file', dummyPath);

    fs.unlinkSync(dummyPath);

    expect(res.status).toBe(403);
  });
  
  it('deve permitir download de anexo para membros da conversa', async () => {
    const dummyPath = path.join(__dirname, 'dummy.jpg');
    fs.writeFileSync(dummyPath, 'fake image content');

    const resUpload = await request(app)
      .post(`/api/chat/conversations/${conversationId}/messages/upload`)
      .set('Authorization', `Bearer ${user1Token}`)
      .field('type', 'IMAGE')
      .attach('file', dummyPath);

    fs.unlinkSync(dummyPath);
    
    const attachmentId = resUpload.body.message.attachment.id;

    // User 2 (na conversa) tenta baixar
    const resDownload = await request(app)
      .get(`/api/chat/attachments/${attachmentId}`)
      .set('Authorization', `Bearer ${user2Token}`);

    expect(resDownload.status).toBe(200);
  });

  it('NÃO deve permitir download de anexo para não-membros', async () => {
    const dummyPath = path.join(__dirname, 'dummy.jpg');
    fs.writeFileSync(dummyPath, 'fake');

    const resUpload = await request(app)
      .post(`/api/chat/conversations/${conversationId}/messages/upload`)
      .set('Authorization', `Bearer ${user1Token}`)
      .field('type', 'IMAGE')
      .attach('file', dummyPath);

    fs.unlinkSync(dummyPath);
    
    const attachmentId = resUpload.body.message.attachment.id;

    // User 3 (outra familia/não está na conversa) tenta baixar
    const resDownload = await request(app)
      .get(`/api/chat/attachments/${attachmentId}`)
      .set('Authorization', `Bearer ${user3Token}`);

    expect(resDownload.status).toBe(403);
  });
});
