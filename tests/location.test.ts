import request from 'supertest';
import app from '../src/app';
import prisma from '../src/utils/prisma';
import { generateAccessToken } from '../src/utils/auth';
import { createServer } from 'http';
import { initSocket } from '../src/sockets/socketManager';

let server: ReturnType<typeof createServer>;

beforeAll(async () => {
  server = createServer(app);
  initSocket(server);
});

afterAll(async () => {
  server.close();
  await prisma.$disconnect();
});

describe('Location Endpoints', () => {
  let user1Token: string;
  let user2Token: string;
  let user3Token: string; // Outra família
  let familyAId: string;
  let familyBId: string;

  beforeEach(async () => {
    // Setup das famílias e usuários
    const familyA = await prisma.family.create({ data: { name: 'Família A' } });
    familyAId = familyA.id;

    const user1 = await prisma.user.create({
      data: {
        familyId: familyAId,
        role: 'ADMIN',
        name: 'User 1',
        displayName: 'User 1',
        email: 'user1@test.com',
        password: 'hash',
        isSharingLocation: true
      }
    });
    user1Token = generateAccessToken({ userId: user1.id, familyId: familyAId, role: 'ADMIN' });

    const user2 = await prisma.user.create({
      data: {
        familyId: familyAId,
        role: 'MEMBER',
        name: 'User 2',
        displayName: 'User 2',
        email: 'user2@test.com',
        password: 'hash',
        isSharingLocation: false
      }
    });
    user2Token = generateAccessToken({ userId: user2.id, familyId: familyAId, role: 'MEMBER' });

    const familyB = await prisma.family.create({ data: { name: 'Família B' } });
    familyBId = familyB.id;

    const user3 = await prisma.user.create({
      data: {
        familyId: familyBId,
        role: 'ADMIN',
        name: 'User 3',
        displayName: 'User 3',
        email: 'user3@test.com',
        password: 'hash',
        isSharingLocation: true
      }
    });
    user3Token = generateAccessToken({ userId: user3.id, familyId: familyBId, role: 'ADMIN' });
  });

  it('deve atualizar a localização de usuário com compartilhamento ON', async () => {
    const res = await request(app)
      .post('/api/location')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ latitude: -23.5, longitude: -46.6, accuracy: 10, batteryLevel: 0.8 });

    expect(res.status).toBe(200);
    expect(res.body.location).toHaveProperty('latitude', -23.5);
  });

  it('NÃO deve atualizar a localização de usuário com compartilhamento OFF', async () => {
    const res = await request(app)
      .post('/api/location')
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ latitude: -23.5, longitude: -46.6 });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Compartilhamento de localização desativado');
  });

  it('deve permitir usuário alterar seu status de compartilhamento', async () => {
    const res = await request(app)
      .post('/api/location/toggle')
      .set('Authorization', `Bearer ${user2Token}`)
      .send({ isSharing: true });

    expect(res.status).toBe(200);
    expect(res.body.isSharing).toBe(true);

    const checkUser = await prisma.user.findUnique({ where: { email: 'user2@test.com' } });
    expect(checkUser?.isSharingLocation).toBe(true);
  });

  it('deve retornar apenas localizações de membros da mesma família', async () => {
    // user3 (Família B) atualiza sua localização
    await request(app)
      .post('/api/location')
      .set('Authorization', `Bearer ${user3Token}`)
      .send({ latitude: 10, longitude: 10 });

    // user1 (Família A) atualiza sua localização
    await request(app)
      .post('/api/location')
      .set('Authorization', `Bearer ${user1Token}`)
      .send({ latitude: 20, longitude: 20 });

    // user1 (Família A) busca localizações
    const res = await request(app)
      .get('/api/location')
      .set('Authorization', `Bearer ${user1Token}`);

    expect(res.status).toBe(200);
    // Só deve ver a de user1 (pois user2 ativou agora, mas não mandou coordenada ainda, e user3 é de outra família)
    expect(res.body.locations.length).toBe(1);
    expect(res.body.locations[0].user.displayName).toBe('User 1');
  });
});
