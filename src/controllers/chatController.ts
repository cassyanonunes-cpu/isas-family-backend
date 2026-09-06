import { Response } from 'express';
import { AuthRequest } from '../middlewares/authMiddleware';
import prisma from '../utils/prisma';
import { emitNewMessage, emitConversationUpdated, emitToConversation } from '../sockets/socketManager';
import { storageService } from '../services/storageService';
import { pushService } from '../services/pushService';

export const createDirectConversation = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  const { targetUserId } = req.body;

  if (!user || !targetUserId) {
    res.status(400).json({ error: 'Usuário alvo não fornecido' });
    return;
  }

  if (user.userId === targetUserId) {
    res.status(400).json({ error: 'Não é possível iniciar uma conversa consigo mesmo' });
    return;
  }

  try {
    // 1. Validar se targetUserId pertence à mesma família
    const targetUser = await prisma.user.findFirst({
      where: { id: targetUserId, familyId: user.familyId }
    });

    if (!targetUser) {
      res.status(403).json({ error: 'Usuário não encontrado na mesma família' });
      return;
    }

    // 2. Verificar se já existe conversa DIRECT entre os dois
    const existingConversation = await prisma.conversation.findFirst({
      where: {
        familyId: user.familyId,
        type: 'DIRECT',
        AND: [
          { members: { some: { userId: user.userId } } },
          { members: { some: { userId: targetUserId } } }
        ]
      }
    });

    if (existingConversation) {
      res.status(200).json({ conversation: existingConversation });
      return;
    }

    // 3. Criar nova conversa DIRECT
    const newConversation = await prisma.conversation.create({
      data: {
        familyId: user.familyId,
        type: 'DIRECT',
        members: {
          create: [
            { userId: user.userId, role: 'ADMIN' },
            { userId: targetUserId, role: 'ADMIN' }
          ]
        }
      }
    });

    res.status(201).json({ conversation: newConversation });
  } catch (error) {
    console.error('Erro ao criar conversa direta:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
};

export const createGroupConversation = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  const { name, participantIds } = req.body;

  if (!user || !name || !Array.isArray(participantIds)) {
    res.status(400).json({ error: 'Nome e lista de participantes são obrigatórios' });
    return;
  }

  try {
    // 1. Validar participantes
    const allIds = Array.from(new Set([user.userId, ...participantIds]));
    
    const validUsers = await prisma.user.findMany({
      where: { id: { in: allIds }, familyId: user.familyId }
    });

    if (validUsers.length !== allIds.length) {
      res.status(403).json({ error: 'Um ou mais usuários não pertencem a esta família' });
      return;
    }

    // 2. Criar grupo
    const membersData = allIds.map(id => ({
      userId: id,
      role: id === user.userId ? 'ADMIN' : 'MEMBER'
    }));

    const newGroup = await prisma.conversation.create({
      data: {
        familyId: user.familyId,
        type: 'GROUP',
        name,
        members: {
          create: membersData
        }
      }
    });

    res.status(201).json({ conversation: newGroup });
  } catch (error) {
    console.error('Erro ao criar grupo:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
};

export const sendMessage = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  const conversationId = req.params['conversationId'] as string;
  const { content, clientMessageId } = req.body as { content: string; clientMessageId?: string };

  if (!user || !content) {
    res.status(400).json({ error: 'Conteúdo da mensagem é obrigatório' });
    return;
  }

  try {
    // 1. Validar se o usuário é participante
    const membership = await prisma.conversationMember.findUnique({
      where: {
        conversationId_userId: { conversationId, userId: user.userId }
      }
    });

    if (!membership) {
      res.status(403).json({ error: 'Você não tem permissão para enviar mensagens nesta conversa' });
      return;
    }

    // 2. Idempotência: verificar clientMessageId
    if (clientMessageId) {
      const existingMsg = await prisma.message.findUnique({
        where: { clientMessageId }
      });
      if (existingMsg) {
        res.status(200).json({ message: existingMsg });
        return;
      }
    }

    // 3. Criar mensagem
    const newMessage = await prisma.message.create({
      data: {
        conversationId,
        senderId: user.userId,
        content,
        clientMessageId,
        type: 'TEXT',
        status: 'SENT'
      }
    });

    // 4. Atualizar o updatedAt da conversa
    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() }
    });

    // 5. Emitir evento via WebSocket
    emitNewMessage(conversationId, newMessage);
    emitConversationUpdated(conversationId, newMessage);

    // 6. Enviar Push Notification
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { members: { include: { user: true } } }
    });

    if (conversation) {
      const sender = conversation.members.find(m => m.userId === user.userId)?.user;
      const title = conversation.type === 'GROUP' ? `${sender?.displayName} em ${conversation.name}` : sender?.displayName || 'Isas Family';
      const body = 'Nova mensagem'; // Privacidade: podemos ocultar o content aqui baseado na flag depois

      for (const member of conversation.members) {
        if (member.userId !== user.userId) {
          await pushService.sendNotification(member.userId, {
            title,
            body,
            data: { conversationId, type: 'MESSAGE' }
          });
        }
      }
    }

    res.status(201).json({ message: newMessage });
  } catch (error) {
    console.error('Erro ao enviar mensagem:', error);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
};

export const getMessages = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  const conversationId = req.params['conversationId'] as string;
  const limit = (req.query['limit'] as string | undefined) ?? '20';
  const cursor = req.query['cursor'] as string | undefined;

  if (!user) {
    res.status(401).json({ error: 'Não autorizado' });
    return;
  }

  try {
    // Validar participação
    const membership = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: user.userId } }
    });

    if (!membership) {
      res.status(403).json({ error: 'Acesso negado' });
      return;
    }

    const take = parseInt(limit, 10);
    const cursorObj = cursor ? { id: cursor } : undefined;

    const messages = await prisma.message.findMany({
      where: { conversationId },
      take: take + 1, // Pega um a mais para verificar hasNextPage
      cursor: cursorObj,
      orderBy: { createdAt: 'desc' },
      include: { attachment: true, receipts: true }
    });

    let hasNextPage = false;
    let nextCursor = null;

    if (messages.length > take) {
      hasNextPage = true;
      const nextMessage = messages.pop();
      nextCursor = nextMessage?.id || null;
    }

    res.json({
      messages: messages.reverse(), // Ordenar do mais antigo para o mais novo no payload final
      hasNextPage,
      nextCursor
    });
  } catch (error) {
    console.error('Erro ao buscar mensagens:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
};

export const listConversations = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;

  if (!user) {
    res.status(401).json({ error: 'Não autorizado' });
    return;
  }

  try {
    const memberships = await prisma.conversationMember.findMany({
      where: { userId: user.userId },
      include: {
        conversation: {
          include: {
            members: {
              include: {
                user: { select: { id: true, displayName: true, avatarUrl: true } }
              }
            },
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 1
            },
            _count: {
              select: {
                messages: {
                  where: {
                    senderId: { not: user.userId },
                    NOT: { receipts: { some: { userId: user.userId, status: 'READ' } } }
                  }
                }
              }
            }
          }
        }
      },
      orderBy: { conversation: { updatedAt: 'desc' } }
    });

    const formatted = memberships.map(m => {
      const conv = m.conversation;
      const lastMessage = conv.messages[0] || null;
      let name = conv.name;

      if (conv.type === 'DIRECT') {
        const otherMember = conv.members.find(member => member.userId !== user.userId);
        name = otherMember ? otherMember.user.displayName : 'Usuário Desconhecido';
      }

      return {
        id: conv.id,
        type: conv.type,
        name,
        lastMessage: lastMessage ? {
          content: lastMessage.content,
          createdAt: lastMessage.createdAt
        } : null,
        unreadCount: conv._count.messages,
        updatedAt: conv.updatedAt,
        members: conv.members.map(mb => ({
          userId: mb.userId,
          role: mb.role,
          user: mb.user
        }))
      };
    });

    res.json({ conversations: formatted });
  } catch (error) {
    console.error('Erro ao listar conversas:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
};

export const updateGroupProfile = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  const id = req.params['id'] as string;
  const { name, description, avatarUrl } = req.body;

  if (!user || (!name && !description && !avatarUrl)) {
    res.status(400).json({ error: 'Dados inválidos' });
    return;
  }

  try {
    const membership = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: id, userId: user.userId } }
    });

    if (!membership || membership.role !== 'ADMIN') {
      res.status(403).json({ error: 'Apenas administradores podem editar o grupo' });
      return;
    }

    const updatedGroup = await prisma.conversation.update({
      where: { id },
      data: { 
        ...(name && { name }),
        ...(description !== undefined && { description }),
        ...(avatarUrl !== undefined && { avatarUrl })
      }
    });

    res.json({ conversation: updatedGroup });
  } catch (error) {
    console.error('Erro ao editar grupo:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
};

export const addGroupMember = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  const id = req.params['id'] as string;
  const { newUserId } = req.body;

  if (!user || !newUserId) {
    res.status(400).json({ error: 'Novo usuário obrigatório' });
    return;
  }

  try {
    const membership = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: id, userId: user.userId } }
    });

    if (!membership || membership.role !== 'ADMIN') {
      res.status(403).json({ error: 'Apenas administradores podem adicionar membros' });
      return;
    }

    const conversation = await prisma.conversation.findUnique({ where: { id } });
    if (!conversation || conversation.type !== 'GROUP') {
      res.status(400).json({ error: 'Conversa inválida ou não é um grupo' });
      return;
    }

    const targetUser = await prisma.user.findFirst({
      where: { id: newUserId, familyId: user.familyId }
    });

    if (!targetUser) {
      res.status(403).json({ error: 'Usuário não pertence à mesma família' });
      return;
    }

    const existingMember = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: id, userId: newUserId } }
    });

    if (existingMember) {
      res.status(400).json({ error: 'Usuário já está no grupo' });
      return;
    }

    await prisma.conversationMember.create({
      data: { conversationId: id, userId: newUserId, role: 'MEMBER' }
    });

    res.json({ message: 'Membro adicionado' });
  } catch (error) {
    console.error('Erro ao adicionar membro:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
};

export const removeGroupMember = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  const id = req.params['id'] as string;
  const targetUserId = req.params['userId'] as string;

  if (!user || !targetUserId) {
    res.status(400).json({ error: 'Dados obrigatórios' });
    return;
  }

  try {
    const membership = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: id, userId: user.userId } }
    });

    if (!membership || membership.role !== 'ADMIN') {
      res.status(403).json({ error: 'Apenas administradores podem remover membros' });
      return;
    }

    if (targetUserId === user.userId) {
      res.status(400).json({ error: 'Você não pode remover a si mesmo por aqui' });
      return;
    }

    await prisma.conversationMember.delete({
      where: { conversationId_userId: { conversationId: id, userId: targetUserId } }
    });

    res.json({ message: 'Membro removido' });
  } catch (error) {
    console.error('Erro ao remover membro:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
};

export const uploadAttachment = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  const conversationId = req.params['conversationId'] as string;
  const file = req.file;
  const { clientMessageId, type, content = '', width, height, duration } = req.body;

  if (!user || !file || !type) {
    res.status(400).json({ error: 'Dados obrigatórios ausentes' });
    return;
  }

  try {
    const membership = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: user.userId } }
    });

    if (!membership) {
      res.status(403).json({ error: 'Acesso negado à conversa' });
      return;
    }

    // Salvar arquivo usando StorageService
    const storageKey = await storageService.uploadFile(file);

    const newMessage = await prisma.message.create({
      data: {
        conversationId,
        senderId: user.userId,
        content,
        clientMessageId,
        type: type, // IMAGE, VIDEO, AUDIO, DOCUMENT
        status: 'SENT',
        attachment: {
          create: {
            type,
            storageKey,
            mimeType: file.mimetype,
            originalName: file.originalname,
            size: file.size,
            width: width ? parseInt(width) : null,
            height: height ? parseInt(height) : null,
            duration: duration ? parseInt(duration) : null
          }
        }
      },
      include: { attachment: true }
    });

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() }
    });

    emitNewMessage(conversationId, newMessage);
    emitConversationUpdated(conversationId, newMessage);

    res.status(201).json({ message: newMessage });
  } catch (error) {
    console.error('Erro no upload:', error);
    res.status(500).json({ error: 'Erro no servidor' });
  }
};

export const downloadAttachment = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  const attachmentId = req.params['attachmentId'] as string;

  if (!user) {
    res.status(401).json({ error: 'Não autorizado' });
    return;
  }

  try {
    const attachment = await prisma.messageAttachment.findUnique({
      where: { id: attachmentId }
    });

    if (!attachment) {
      res.status(404).json({ error: 'Arquivo não encontrado' });
      return;
    }

    // Buscar a mensagem separadamente para validar a conversa
    const msg = await prisma.message.findUnique({ where: { id: attachment.messageId } });
    if (!msg) {
      res.status(404).json({ error: 'Mensagem associada não encontrada' });
      return;
    }

    // Validar se o usuário pertence à conversa da mensagem
    const membership = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId: msg.conversationId, userId: user.userId } }
    });

    if (!membership) {
      res.status(403).json({ error: 'Acesso negado' });
      return;
    }

    const fileData = await storageService.getFileData(attachment.storageKey);
    if (!fileData) {
      res.status(404).json({ error: 'Dados do arquivo não encontrados no armazenamento' });
      return;
    }

    res.setHeader('Content-Type', attachment.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${attachment.originalName}"`);
    res.send(fileData);
  } catch (error) {
    console.error('Erro ao baixar anexo:', error);
    res.status(500).json({ error: 'Erro no servidor' });
  }
};

export const markMessagesAsRead = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user;
  const conversationId = req.params['conversationId'] as string;

  if (!user) {
    res.status(401).json({ error: 'Não autorizado' });
    return;
  }

  try {
    const membership = await prisma.conversationMember.findUnique({
      where: { conversationId_userId: { conversationId, userId: user.userId } }
    });

    if (!membership) {
      res.status(403).json({ error: 'Acesso negado' });
      return;
    }

    // Busca todas as mensagens não lidas por esse usuário nessa conversa
    const unreadMessages = await prisma.message.findMany({
      where: {
        conversationId,
        senderId: { not: user.userId },
        NOT: { receipts: { some: { userId: user.userId, status: 'READ' } } }
      }
    });

    if (unreadMessages.length === 0) {
      res.status(200).json({ success: true, count: 0 });
      return;
    }

    // Atualiza status de leitura via upsert no MessageReceipt
    for (const msg of unreadMessages) {
      await prisma.messageReceipt.upsert({
        where: { messageId_userId: { messageId: msg.id, userId: user.userId } },
        update: { status: 'READ', updatedAt: new Date() },
        create: { messageId: msg.id, userId: user.userId, status: 'READ' }
      });
    }

    // Emitir no socket
    emitToConversation(conversationId, 'chat:read_receipt', {
      conversationId,
      userId: user.userId,
      messageIds: unreadMessages.map(m => m.id)
    });

    res.status(200).json({ success: true, count: unreadMessages.length });
  } catch (error) {
    console.error('Erro ao marcar mensagens como lidas:', error);
    res.status(500).json({ error: 'Erro interno' });
  }
};
