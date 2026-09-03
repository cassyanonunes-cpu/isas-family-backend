import request from 'supertest';
import app from '../src/app';
import prisma from '../src/utils/prisma';
import { hashPassword } from '../src/utils/auth';
import { Server } from 'socket.io';
import http from 'http';
import Client from 'socket.io-client';

describe('Chat Endpoints', () => {
  let adminToken: string;
  let memberToken: string;
  let otherFamilyMemberToken: string;
  let familyId: string;
  let otherFamilyId: string;
  let adminId: string;
  let memberId: string;
  let otherMemberId: string;

  beforeEach(async () => {
    const family = await prisma.family.create({ data: { name: 'Chat Family' } });
    familyId = family.id;

    const otherFamily = await prisma.family.create({ data: { name: 'Other Family' } });
    otherFamilyId = otherFamily.id;

    const hashedPassword = await hashPassword('pass');

    const admin = await prisma.user.create({
      data: { familyId, name: 'Admin', displayName: 'A', email: 'a@c.com', password: hashedPassword, role: 'ADMIN' }
    });
    adminId = admin.id;

    const member = await prisma.user.create({
      data: { familyId, name: 'Member', displayName: 'M', email: 'm@c.com', password: hashedPassword, role: 'MEMBER' }
    });
    memberId = member.id;

    const otherMember = await prisma.user.create({
      data: { familyId: otherFamilyId, name: 'Other', displayName: 'O', email: 'o@c.com', password: hashedPassword, role: 'MEMBER' }
    });
    otherMemberId = otherMember.id;

    const la = await request(app).post('/api/auth/login').send({ email: 'a@c.com', password: 'pass', platform: 'IOS', identifier: 'd1' });
    adminToken = la.body.accessToken;

    const lm = await request(app).post('/api/auth/login').send({ email: 'm@c.com', password: 'pass', platform: 'IOS', identifier: 'd2' });
    memberToken = lm.body.accessToken;

    const lo = await request(app).post('/api/auth/login').send({ email: 'o@c.com', password: 'pass', platform: 'IOS', identifier: 'd3' });
    otherFamilyMemberToken = lo.body.accessToken;
  });

  describe('Conversas DIRECT', () => {
    it('deve criar uma conversa direta', async () => {
      const res = await request(app).post('/api/chat/conversations/direct')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ targetUserId: memberId });

      expect(res.status).toBe(201);
      expect(res.body.conversation.type).toBe('DIRECT');
    });

    it('NÃO deve duplicar conversa direta existente', async () => {
      await request(app).post('/api/chat/conversations/direct')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ targetUserId: memberId });

      const res2 = await request(app).post('/api/chat/conversations/direct')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ targetUserId: memberId });

      expect(res2.status).toBe(200); // 200 ao invés de 201 significa que retornou existente
    });

    it('NÃO deve permitir conversa com membro de outra família', async () => {
      const res = await request(app).post('/api/chat/conversations/direct')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ targetUserId: otherMemberId });

      expect(res.status).toBe(403);
    });
  });

  describe('Grupos', () => {
    it('deve criar um grupo com membros da mesma família', async () => {
      const res = await request(app).post('/api/chat/conversations/group')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Família Feliz', participantIds: [memberId] });

      expect(res.status).toBe(201);
      expect(res.body.conversation.name).toBe('Família Feliz');
      expect(res.body.conversation.type).toBe('GROUP');
    });

    it('NÃO deve criar grupo se incluir membro de outra família', async () => {
      const res = await request(app).post('/api/chat/conversations/group')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ name: 'Grupo Inválido', participantIds: [memberId, otherMemberId] });

      expect(res.status).toBe(403);
    });
  });

  describe('Mensagens e Histórico', () => {
    let convId: string;

    beforeEach(async () => {
      const res = await request(app).post('/api/chat/conversations/direct')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ targetUserId: memberId });
      convId = res.body.conversation.id;
    });

    it('deve enviar uma mensagem', async () => {
      const res = await request(app).post(`/api/chat/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ content: 'Olá!', clientMessageId: 'msg-1' });

      expect(res.status).toBe(201);
      expect(res.body.message.content).toBe('Olá!');
    });

    it('deve ser idempotente (não duplicar clientMessageId)', async () => {
      await request(app).post(`/api/chat/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ content: 'Olá!', clientMessageId: 'msg-2' });

      const res2 = await request(app).post(`/api/chat/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ content: 'Olá 2!', clientMessageId: 'msg-2' }); // Mesma ID

      expect(res2.status).toBe(200); // 200 = existente
      expect(res2.body.message.content).toBe('Olá!'); // Retornou a antiga
    });

    it('NÃO deve permitir enviar mensagem em conversa não participada', async () => {
      const res = await request(app).post(`/api/chat/conversations/${convId}/messages`)
        .set('Authorization', `Bearer ${otherFamilyMemberToken}`) // Outra familia
        .send({ content: 'Hacker!' });

      expect(res.status).toBe(403);
    });

    it('deve retornar histórico com paginação', async () => {
      // Inserir 25 mensagens
      for (let i = 0; i < 25; i++) {
        await request(app).post(`/api/chat/conversations/${convId}/messages`)
          .set('Authorization', `Bearer ${adminToken}`)
          .send({ content: `Msg ${i}` });
      }

      // Buscar página 1 (últimas 20)
      const res = await request(app).get(`/api/chat/conversations/${convId}/messages?limit=20`)
        .set('Authorization', `Bearer ${memberToken}`); // Outro participante pode ler

      expect(res.status).toBe(200);
      expect(res.body.messages).toHaveLength(20);
      expect(res.body.hasNextPage).toBe(true);
      expect(res.body.nextCursor).toBeDefined();

      // Buscar página 2
      const res2 = await request(app).get(`/api/chat/conversations/${convId}/messages?limit=20&cursor=${res.body.nextCursor}`)
        .set('Authorization', `Bearer ${memberToken}`);

      expect(res2.status).toBe(200);
      expect(res2.body.messages).toHaveLength(5); // Restam 5
      expect(res2.body.hasNextPage).toBe(false);
    });
  });
});
