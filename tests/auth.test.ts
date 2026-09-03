import request from 'supertest';
import app from '../src/app';
import prisma from '../src/utils/prisma';
import { hashPassword } from '../src/utils/auth';

describe('Auth & Family Endpoints', () => {
  let familyId: string;
  let adminId: string;
  let adminToken: string;
  let refreshToken: string;

  beforeEach(async () => {
    // Criação inicial da família e administrador (Bootstrap)
    const family = await prisma.family.create({
      data: { name: 'Test Family' }
    });
    familyId = family.id;

    const hashedPassword = await hashPassword('password123');
    const admin = await prisma.user.create({
      data: {
        familyId: family.id,
        name: 'Test Admin',
        displayName: 'Admin',
        email: 'admin@test.com',
        password: hashedPassword,
        role: 'ADMIN'
      }
    });
    adminId = admin.id;
  });

  describe('POST /api/auth/login', () => {
    it('deve fazer login com credenciais válidas e gerar tokens', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'admin@test.com',
          password: 'password123',
          platform: 'IOS',
          identifier: 'device-1'
        });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('accessToken');
      expect(res.body).toHaveProperty('refreshToken');
      expect(res.body.user).toHaveProperty('id', adminId);
      expect(res.body.user).not.toHaveProperty('password');
      
      adminToken = res.body.accessToken;
      refreshToken = res.body.refreshToken;
    });

    it('deve rejeitar login com senha incorreta', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'admin@test.com',
          password: 'wrongpassword',
          platform: 'IOS',
          identifier: 'device-1'
        });

      expect(res.status).toBe(401);
      expect(res.body.error).toBe('Credenciais inválidas');
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('deve gerar novo access token utilizando refresh token', async () => {
      // Faz login primeiro para obter refreshToken
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'admin@test.com',
          password: 'password123',
          platform: 'IOS',
          identifier: 'device-1'
        });
      
      const rt = loginRes.body.refreshToken;

      const res = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: rt });

      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty('accessToken');
    });
  });

  describe('Isolamento e Acesso à Família', () => {
    let userToken: string;

    beforeEach(async () => {
      // Pega o token do admin
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'admin@test.com',
          password: 'password123',
          platform: 'IOS',
          identifier: 'device-1'
        });
      adminToken = loginRes.body.accessToken;

      // Cria uma SEGUNDA família
      const family2 = await prisma.family.create({
        data: { name: 'Second Family' }
      });

      const hashedPassword = await hashPassword('password123');
      await prisma.user.create({
        data: {
          familyId: family2.id,
          name: 'Other User',
          displayName: 'Other',
          email: 'other@test.com',
          password: hashedPassword,
          role: 'MEMBER'
        }
      });

      const loginRes2 = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'other@test.com',
          password: 'password123',
          platform: 'ANDROID',
          identifier: 'device-2'
        });
      userToken = loginRes2.body.accessToken;
    });

    it('deve listar apenas membros da mesma família', async () => {
      const res = await request(app)
        .get('/api/family/members')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.members).toHaveLength(1); // Só tem o Admin na Test Family
      expect(res.body.members[0].email).toBeUndefined(); // Email não deve estar no select por segurança
      expect(res.body.members[0].id).toBe(adminId);
    });

    it('deve negar acesso sem autenticação', async () => {
      const res = await request(app).get('/api/family/members');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /api/auth/logout', () => {
    it('deve deletar o refresh token do banco', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'admin@test.com',
          password: 'password123',
          platform: 'IOS',
          identifier: 'device-1'
        });
      
      const rt = loginRes.body.refreshToken;

      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .send({ refreshToken: rt });

      expect(logoutRes.status).toBe(200);

      // Tentar usar o RT novamente deve falhar
      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: rt });
      
      expect(refreshRes.status).toBe(401);
    });
  });
});
