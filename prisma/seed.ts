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
    data: { name: 'Minha Família (Admin)' }
  });

  // Cria o primeiro usuário administrador
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

  console.log('✅ Seed finalizado com sucesso!');
  console.log('--------------------------------------------------');
  console.log('Família criada:', family.name);
  console.log('Usuário Admin criado:');
  console.log('Email:', admin.email);
  console.log('Senha: 123456');
  console.log('--------------------------------------------------');
  console.log('IMPORTANTE: Altere a senha logo após o primeiro login!');
}

main()
  .catch((e) => {
    console.error('Erro no seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
