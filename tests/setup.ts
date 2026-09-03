import prisma from '../src/utils/prisma';

afterAll(async () => {
  await prisma.$disconnect();
});

afterEach(async () => {
  const deleteCalls = prisma.call.deleteMany();
  const deleteInvitations = prisma.invitation.deleteMany();
  const deleteLocations = prisma.location.deleteMany();
  const deleteMessageAttachments = prisma.messageAttachment.deleteMany();
  const deleteMessages = prisma.message.deleteMany();
  const deleteConversationMembers = prisma.conversationMember.deleteMany();
  const deleteConversations = prisma.conversation.deleteMany();
  const deleteRefreshTokens = prisma.refreshToken.deleteMany();
  const deleteDevices = prisma.device.deleteMany();
  const deleteUsers = prisma.user.deleteMany();
  const deleteFamilies = prisma.family.deleteMany();

  // A ordem de exclusão importa devido a chaves estrangeiras
  await prisma.$transaction([
    deleteCalls,
    deleteInvitations,
    deleteLocations,
    deleteMessageAttachments,
    deleteMessages,
    deleteConversationMembers,
    deleteConversations,
    deleteRefreshTokens,
    deleteDevices,
    deleteUsers,
    deleteFamilies
  ]);
});
