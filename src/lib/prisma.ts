import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Cliente Prisma compartilhado. Usado pelo processo web e pelo worker.
// Em desenvolvimento, reaproveita a instância entre recarregamentos do Next.

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  // Não falha na importação (o build do Next importa os módulos sem banco);
  // a falta de DATABASE_URL aparece na primeira consulta e na validação de env de cada processo.
  const connectionString = process.env.DATABASE_URL;
  const adapter = new PrismaPg({ connectionString, max: Number(process.env.DATABASE_POOL_MAX ?? 5) });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
