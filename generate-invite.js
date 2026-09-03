const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();
const crypto = require('crypto');

async function main() {
  let family = await prisma.family.findFirst();
  
  if (!family) {
    console.log("Nenhuma família encontrada. Criando uma família padrão...");
    family = await prisma.family.create({
      data: { name: "Família Isas" }
    });
  }

  const code = crypto.randomBytes(3).toString('hex').toUpperCase(); // 6 chars
  
  const invitation = await prisma.invitation.create({
    data: {
      familyId: family.id,
      createdBy: "SISTEMA", // Fake user for system generation
      code: code,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    }
  });

  console.log(`CÓDIGO GERADO: ${code}`);
}

main()
  .catch(e => console.error(e))
  .finally(() => prisma.$disconnect());
