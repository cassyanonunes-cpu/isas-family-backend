const { PrismaClient } = require('./node_modules/@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const family = await prisma.family.findFirst();
  if (!family) {
    console.log('No family found');
    return;
  }
  
  const user = await prisma.user.findFirst({ where: { familyId: family.id } });
  await prisma.invitation.create({
    data: {
      code: 'Internacional',
      familyId: family.id,
      createdBy: user.id,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365), // 1 year
    }
  });
  console.log('Invite Internacional created');
}
main().catch(console.error).finally(() => prisma.$disconnect());
