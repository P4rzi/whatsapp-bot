// Cria ou atualiza o usuário administrador.
// Uso (a senha vem de variável de ambiente para não ficar no histórico do terminal como argumento):
//   ADMIN_EMAIL=... ADMIN_NAME=... ADMIN_PASSWORD=... npm run admin:create
// No Railway: rode no serviço web com `railway run` ou pelo console do serviço.
import { hashPassword, PASSWORD_MIN_LENGTH } from "@/lib/auth/password";
import { prisma } from "@/lib/prisma";

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const name = process.env.ADMIN_NAME?.trim() || "Administrador";
  const password = process.env.ADMIN_PASSWORD ?? "";

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error("Defina ADMIN_EMAIL com um e-mail válido.");
  }
  if (password.length < PASSWORD_MIN_LENGTH) {
    throw new Error(`ADMIN_PASSWORD precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres.`);
  }

  const passwordHash = await hashPassword(password);
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name, passwordHash },
    update: { name, passwordHash },
  });
  console.log(`Administrador pronto: ${user.email}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
