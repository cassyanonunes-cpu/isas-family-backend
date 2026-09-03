const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');

const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando o seed do banco de dados...');

  // Verifica se já existe alguma família
  const familyCount = await prisma.family.count();
  if (familyCount > 0) {
    console.log('O banco de dados já possui dados. Seed cancelado.');
    return;
  }

  // Cria a primeira família
  const family = await prisma.family.create({
    data: { name: 'Minha Família' }
  });

  // Cria um usuário Administrador inicial nos bastidores (necessário para criar o convite)
  const hash = await bcrypt.hash('123456', 10);
  const admin = await prisma.user.create({
    data: {
      name: 'Administrador',
      displayName: 'Admin',
      email: 'admin@admin.com',
      password: hash,
      role: 'ADMIN',
      familyId: family.id
    }
  });

  // Cria um código de convite mestre para o primeiro acesso no app
  const crypto = require('crypto');
  const token = crypto.randomBytes(4).toString('hex').toUpperCase();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30); // 30 dias

  const invitation = await prisma.invitation.create({
    data: {
      familyId: family.id,
      createdBy: admin.id,
      code: token,
      status: 'PENDING',
      expiresAt
    }
  });

  console.log('✅ Seed finalizado com sucesso!');
  console.log('--------------------------------------------------');
  console.log('Família criada:', family.name);
  console.log('SEU CÓDIGO DE CONVITE INICIAL É:');
  console.log(`\n    ====>  ${token}  <====\n`);
  console.log('Abra o aplicativo e cole este código para entrar na conta!');
  console.log('--------------------------------------------------');
}

main()
  .catch((e) => {
    console.error('Erro no seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
