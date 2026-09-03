import request from 'supertest';
import app from '../src/app';
import prisma from '../src/utils/prisma';
import { hashPassword } from '../src/utils/auth';

describe('Invitation Endpoints', () => {
  let adminToken: string;
  let memberToken: string;
  let familyId: string;
  let adminId: string;
  let memberId: string;

  beforeEach(async () => {
    // 1. Criar Família 1
    const family = await prisma.family.create({ data: { name: 'Family 1' } });
    familyId = family.id;

    // 2. Criar Admin
    const hashedPassword = await hashPassword('password123');
    const admin = await prisma.user.create({
      data: {
        familyId,
        name: 'Admin User',
        displayName: 'Admin',
        email: 'admin@family1.com',
        password: hashedPassword,
        role: 'ADMIN'
      }
    });
    adminId = admin.id;

    // 3. Criar Membro
    const member = await prisma.user.create({
      data: {
        familyId,
        name: 'Member User',
        displayName: 'Member',
        email: 'member@family1.com',
        password: hashedPassword,
        role: 'MEMBER'
      }
    });
    memberId = member.id;

    // 4. Obter Tokens
    const loginAdmin = await request(app).post('/api/auth/login').send({
      email: 'admin@family1.com', password: 'password123', platform: 'IOS', identifier: 'dev1'
    });
    adminToken = loginAdmin.body.accessToken;

    const loginMember = await request(app).post('/api/auth/login').send({
      email: 'member@family1.com', password: 'password123', platform: 'IOS', identifier: 'dev2'
    });
    memberToken = loginMember.body.accessToken;
  });

  describe('Criação de Convite (Admin)', () => {
    it('deve permitir que ADMIN crie um convite', async () => {
      const res = await request(app)
        .post('/api/invitations')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(201);
      expect(res.body.invitation).toHaveProperty('code');
      expect(res.body.invitation.status).toBe('PENDING');
      
      const dbInvite = await prisma.invitation.findUnique({ where: { code: res.body.invitation.code } });
      expect(dbInvite).toBeDefined();
      expect(dbInvite?.familyId).toBe(familyId);
    });

    it('NÃO deve permitir que MEMBER crie um convite', async () => {
      const res = await request(app)
        .post('/api/invitations')
        .set('Authorization', `Bearer ${memberToken}`);

      expect(res.status).toBe(403);
    });
  });

  describe('Validação Pública', () => {
    let inviteCode: string;

    beforeEach(async () => {
      const res = await request(app).post('/api/invitations').set('Authorization', `Bearer ${adminToken}`);
      inviteCode = res.body.invitation.code;
    });

    it('deve validar um convite PENDING corretamente', async () => {
      const res = await request(app).get(`/api/invitations/validate/${inviteCode}`);
      
      expect(res.status).toBe(200);
      expect(res.body.valid).toBe(true);
      expect(res.body.familyName).toBe('Family 1');
      expect(res.body).not.toHaveProperty('createdBy'); // Segurança
    });

    it('deve retornar falso para token inexistente', async () => {
      const res = await request(app).get('/api/invitations/validate/nonexistent-token');
      expect(res.status).toBe(404);
      expect(res.body.valid).toBe(false);
    });
  });

  describe('Aceitar Convite (Criar nova conta)', () => {
    let inviteCode: string;
    let inviteId: string;

    beforeEach(async () => {
      const res = await request(app).post('/api/invitations').set('Authorization', `Bearer ${adminToken}`);
      inviteCode = res.body.invitation.code;
      inviteId = res.body.invitation.id;
    });

    it('deve criar conta com sucesso e associar à família correta', async () => {
      const res = await request(app)
        .post(`/api/invitations/accept/${inviteCode}`)
        .send({
          name: 'New Familiar',
          displayName: 'Familiar',
          email: 'new@family1.com',
          password: 'securepassword',
          role: 'ADMIN', // Tentativa maliciosa
          familyId: '12345' // Tentativa maliciosa
        });

      expect(res.status).toBe(201);
      expect(res.body.user).toHaveProperty('id');
      expect(res.body.user.role).toBe('MEMBER'); // Forçado pelo backend
      expect(res.body.user.familyId).toBe(familyId);

      // O convite deve constar como ACCEPTED
      const dbInvite = await prisma.invitation.findUnique({ where: { id: inviteId } });
      expect(dbInvite?.status).toBe('ACCEPTED');
      expect(dbInvite?.usedById).toBe(res.body.user.id);
    });

    it('deve impedir o uso de um e-mail já cadastrado', async () => {
      const res = await request(app)
        .post(`/api/invitations/accept/${inviteCode}`)
        .send({
          name: 'Duplicate Email',
          displayName: 'Dup',
          email: 'admin@family1.com', // Já existe
          password: 'securepassword'
        });

      expect(res.status).toBe(409);
      expect(res.body.error).toBe('E-mail já está em uso');

      // Convite deve continuar PENDING
      const dbInvite = await prisma.invitation.findUnique({ where: { id: inviteId } });
      expect(dbInvite?.status).toBe('PENDING');
    });

    it('deve impedir a reutilização de um convite já aceito', async () => {
      // Primeira utilização
      await request(app).post(`/api/invitations/accept/${inviteCode}`).send({
        name: 'User 1', displayName: 'U1', email: 'u1@test.com', password: '123'
      });

      // Segunda utilização
      const res = await request(app).post(`/api/invitations/accept/${inviteCode}`).send({
        name: 'User 2', displayName: 'U2', email: 'u2@test.com', password: '123'
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Convite indisponível para uso');
    });
  });

  describe('Administração de Convites', () => {
    it('Admin deve poder cancelar convite da própria família', async () => {
      const resCreate = await request(app).post('/api/invitations').set('Authorization', `Bearer ${adminToken}`);
      const inviteId = resCreate.body.invitation.id;

      const resCancel = await request(app).post(`/api/invitations/${inviteId}/cancel`).set('Authorization', `Bearer ${adminToken}`);
      expect(resCancel.status).toBe(200);

      const dbInvite = await prisma.invitation.findUnique({ where: { id: inviteId } });
      expect(dbInvite?.status).toBe('CANCELLED');
    });

    it('NÃO deve validar convite cancelado', async () => {
      const resCreate = await request(app).post('/api/invitations').set('Authorization', `Bearer ${adminToken}`);
      const inviteCode = resCreate.body.invitation.code;
      const inviteId = resCreate.body.invitation.id;

      await request(app).post(`/api/invitations/${inviteId}/cancel`).set('Authorization', `Bearer ${adminToken}`);

      const resValidate = await request(app).get(`/api/invitations/validate/${inviteCode}`);
      expect(resValidate.status).toBe(400);
      expect(resValidate.body.error).toBe('Convite cancelado');
    });
  });
});
