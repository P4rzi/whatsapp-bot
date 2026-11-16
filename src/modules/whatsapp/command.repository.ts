import type { SystemCommandType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

// Fila de comandos painel -> worker, na tabela SystemCommand.

/** Comando pendente há mais que isso é descartado (o usuário já desistiu de esperar). */
export const COMMAND_TTL_MS = 10 * 60_000;

export class CommandError extends Error {}

/** Painel: registra um comando. Evita empilhar o mesmo comando várias vezes. */
export async function enqueueCommand(type: SystemCommandType) {
  const existing = await prisma.systemCommand.findFirst({
    where: { type, status: { in: ["PENDING", "PROCESSING"] }, createdAt: { gte: new Date(Date.now() - COMMAND_TTL_MS) } },
  });
  if (existing) return existing;
  return prisma.systemCommand.create({ data: { type } });
}

export type ClaimedCommand = { id: string; type: SystemCommandType };

/**
 * Worker: reserva o comando pendente mais antigo de forma atômica.
 * FOR UPDATE SKIP LOCKED garante que duas execuções nunca peguem o mesmo comando.
 */
export async function claimNextCommand(): Promise<ClaimedCommand | null> {
  const rows = await prisma.$queryRaw<ClaimedCommand[]>`
    UPDATE "SystemCommand" SET status = 'PROCESSING'
    WHERE id = (
      SELECT id FROM "SystemCommand"
      WHERE status = 'PENDING'
      ORDER BY "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, type`;
  return rows[0] ?? null;
}

export async function completeCommand(id: string, error?: string) {
  await prisma.systemCommand.update({
    where: { id },
    data: { status: error ? "FAILED" : "DONE", error: error ?? null, processedAt: new Date() },
  });
}

/**
 * Worker, ao iniciar: comandos que ficaram "PROCESSING" (worker caiu no meio) e
 * pendentes muito antigos são marcados como falha.
 */
export async function expireStaleCommands() {
  const now = new Date();
  const { count: interrupted } = await prisma.systemCommand.updateMany({
    where: { status: "PROCESSING" },
    data: { status: "FAILED", error: "Interrompido: o serviço de envio reiniciou.", processedAt: now },
  });
  const { count: expired } = await prisma.systemCommand.updateMany({
    where: { status: "PENDING", createdAt: { lt: new Date(now.getTime() - COMMAND_TTL_MS) } },
    data: { status: "FAILED", error: "Expirado sem ser processado.", processedAt: now },
  });
  return { interrupted, expired };
}
