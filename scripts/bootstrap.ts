import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../src/utils/auth';

const prisma = new PrismaClient();

async function main() {
  console.log('Iniciando o bootstrap da Primeira Família e Admin...');

  // Verifica se já existe uma família
  const existingFamily = await prisma.family.findFirst();
  if (existingFamily) {
    console.log('Atenção: Já existe uma família no banco de dados. Bootstrap cancelado para evitar duplicidade.');
    return;
  }

  // Criar família
  const family = await prisma.family.create({
    data: {
      name: 'Família Principal (Admin)'
    }
  });

  console.log(`Família "${family.name}" criada com ID: ${family.id}`);

  // Criar senha hasheada
  const defaultPassword = 'admin';
  const hashedPassword = await hashPassword(defaultPassword);

  // Criar primeiro usuário admin
  const admin = await prisma.user.create({
    data: {
      familyId: family.id,
      name: 'Administrador Principal',
      displayName: 'Admin',
      email: 'admin@isasfamily.com',
      password: hashedPassword,
      role: 'ADMIN',
      status: 'Bem-vindo ao Isas Family!'
    }
  });

  console.log(`Usuário Admin "${admin.displayName}" criado.`);
  console.log('--- CREDENCIAIS DE ACESSO ---');
  console.log(`Email: ${admin.email}`);
  console.log(`Senha: ${defaultPassword}`);
  console.log('-----------------------------');
  console.log('Por favor, faça login pelo app e altere a senha imediatamente.');
}

main()
  .catch((e) => {
    console.error('Erro durante o bootstrap:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
