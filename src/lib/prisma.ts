import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Cliente Prisma compartilhado. Usado pelo processo web e pelo worker.
// Em desenvolvimento, reaproveita a instância entre recarregamentos do Next.

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  // Não falha na importação (o build do Next importa os módulos sem banco);
  // a falta de DATABASE_URL aparece na primeira consulta e na validação de env de cada processo.
  const connectionString = process.env.DATABASE_URL;
  // ?schema=... na URL (usado pelos testes) direciona as consultas para outro schema do Postgres.
  let schema: string | undefined;
  try {
    schema = connectionString ? (new URL(connectionString).searchParams.get("schema") ?? undefined) : undefined;
  } catch {
    schema = undefined;
  }
  const adapter = new PrismaPg(
    { connectionString, max: Number(process.env.DATABASE_POOL_MAX ?? 5) },
    schema ? { schema } : undefined,
  );
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
