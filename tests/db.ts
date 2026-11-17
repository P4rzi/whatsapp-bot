import { prisma } from "@/lib/prisma";

const TABLES = ["InboundMessage", "MessageAttempt", "Charge", "Customer", "User", "SystemCommand", "WhatsAppConnection", "WorkerHeartbeat", "Settings"];

/** Limpa todas as tabelas do schema de testes. Sempre qualificado com o schema "vitest". */
export async function resetDb() {
  const schema = new URL(process.env.DATABASE_URL!).searchParams.get("schema");
  if (schema !== "vitest") throw new Error(`resetDb só roda no schema "vitest" (atual: ${schema ?? "public"})`);
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"vitest"."${t}"`).join(", ")} CASCADE`);
}

export async function createTestCustomer(overrides: Partial<{ name: string; phone: string; consent: boolean; isActive: boolean; optedOut: boolean }> = {}) {
  return prisma.customer.create({
    data: {
      name: overrides.name ?? "Maria Teste",
      phone: overrides.phone ?? "5511987654321",
      isActive: overrides.isActive ?? true,
      consentAt: overrides.consent === false ? null : new Date(),
      consentSource: overrides.consent === false ? null : "WhatsApp",
      optedOutAt: overrides.optedOut ? new Date() : null,
    },
  });
}
