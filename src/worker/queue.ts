import { prisma } from "@/lib/prisma";

// Fila de envio sobre a própria tabela Charge (sem Redis/BullMQ).
//
// Estados: PENDING -> (reserva) PROCESSING -> SENT | FAILED | PENDING (nova tentativa agendada)
// A reserva é atômica (FOR UPDATE SKIP LOCKED): duas execuções nunca pegam a mesma cobrança.

/** Cobrança em PROCESSING há mais que isso é considerada presa (worker travou ou caiu). */
export const PROCESSING_TIMEOUT_MS = 5 * 60_000;

export const UNKNOWN_RESULT_MESSAGE =
  "Resultado desconhecido: o envio foi interrompido e a mensagem pode ter sido entregue. " +
  "Confira no WhatsApp antes de reenviar.";

/**
 * Reserva a próxima cobrança vencida para esta instância. Retorna o id ou null.
 * Usa o relógio do app (não o now() do banco): todos os horários da fila são gravados pelo app,
 * então comparar com o mesmo relógio evita erros se os relógios divergirem.
 */
export async function claimNextCharge(instanceId: string, now: Date = new Date()): Promise<string | null> {
  const rows = await prisma.$queryRaw<{ id: string }[]>`
    UPDATE "Charge" SET status = 'PROCESSING', "lockedAt" = ${now}, "lockedBy" = ${instanceId}, "updatedAt" = ${now}
    WHERE id = (
      SELECT id FROM "Charge"
      WHERE status = 'PENDING' AND COALESCE("nextAttemptAt", "scheduledAt") <= ${now}
      ORDER BY COALESCE("nextAttemptAt", "scheduledAt") ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id`;
  return rows[0]?.id ?? null;
}

/**
 * Recupera cobranças presas em PROCESSING.
 * - Sem tentativa iniciada: nada foi enviado, volta para PENDING com segurança.
 * - Com tentativa "STARTED": o envio pode ter acontecido. NÃO reenvia: marca a tentativa
 *   como UNKNOWN e a cobrança como FAILED, para o usuário decidir.
 *
 * @param exceptInstance  na inicialização: tudo que não é desta instância é de um worker anterior (morto).
 */
export async function recoverStuckCharges(opts: { olderThanMs?: number; exceptInstance?: string } = {}) {
  const now = new Date();
  const where = {
    status: "PROCESSING" as const,
    ...(opts.exceptInstance
      ? { OR: [{ lockedBy: null }, { lockedBy: { not: opts.exceptInstance } }] }
      : { lockedAt: { lt: new Date(now.getTime() - (opts.olderThanMs ?? PROCESSING_TIMEOUT_MS)) } }),
  };
  const stuck = await prisma.charge.findMany({ where, select: { id: true, lockedBy: true } });

  let requeued = 0;
  let unknown = 0;
  for (const charge of stuck) {
    await prisma.$transaction(async (tx) => {
      const started = await tx.messageAttempt.findMany({ where: { chargeId: charge.id, status: "STARTED" } });
      if (started.length === 0) {
        const { count } = await tx.charge.updateMany({
          where: { id: charge.id, status: "PROCESSING", lockedBy: charge.lockedBy },
          data: { status: "PENDING", lockedAt: null, lockedBy: null },
        });
        requeued += count;
        return;
      }
      await tx.messageAttempt.updateMany({
        where: { chargeId: charge.id, status: "STARTED" },
        data: { status: "UNKNOWN", errorMessage: UNKNOWN_RESULT_MESSAGE, finishedAt: now },
      });
      const { count } = await tx.charge.updateMany({
        where: { id: charge.id, status: "PROCESSING", lockedBy: charge.lockedBy },
        data: { status: "FAILED", lockedAt: null, lockedBy: null, lastError: UNKNOWN_RESULT_MESSAGE },
      });
      unknown += count;
    });
  }
  return { requeued, unknown };
}

/** Devolve uma cobrança reservada para a fila sem contar tentativa (ex.: WhatsApp caiu antes de começar). */
export async function releaseCharge(chargeId: string, instanceId: string) {
  await prisma.charge.updateMany({
    where: { id: chargeId, status: "PROCESSING", lockedBy: instanceId },
    data: { status: "PENDING", lockedAt: null, lockedBy: null },
  });
}
