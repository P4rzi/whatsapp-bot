import type { Logger } from "pino";
import { prisma } from "@/lib/prisma";
import { processCharge, type ProcessorDeps, type ProcessOutcome } from "./processors/message.processor";
import { claimNextCharge, recoverStuckCharges } from "./queue";

// Ciclo de envio: encontra cobranças vencidas e processa uma por vez, com intervalo entre envios.

export type SchedulerDeps = ProcessorDeps & {
  /** Conexão pronta para enviar? (vem do ConnectionManager) */
  isConnected: () => boolean;
  minIntervalMs: number;
  /** Máximo de cobranças por ciclo (o próximo ciclo continua de onde parou). */
  batchSize?: number;
  shouldStop?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
  /** Chamado após cada cobrança processada (o worker grava o batimento: um lote longo não parece travado). */
  onProgress?: () => Promise<void>;
};

export type CycleResult = { processed: number; outcomes: Partial<Record<ProcessOutcome, number>>; skippedNoConnection: boolean };

let lastNoConnectionWarn = 0;

const defaultSleep =(ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runSchedulerCycle(deps: SchedulerDeps): Promise<CycleResult> {
  const result: CycleResult = { processed: 0, outcomes: {}, skippedNoConnection: false };

  const recovered = await recoverStuckCharges();
  if (recovered.requeued || recovered.unknown) deps.logger.warn(recovered, "cobranças presas recuperadas");

  if (!deps.isConnected()) {
    const due = await prisma.charge.count({
      where: { status: "PENDING", OR: [{ nextAttemptAt: { lte: new Date() } }, { nextAttemptAt: null, scheduledAt: { lte: new Date() } }] },
    });
    // Avisa no máximo a cada 5 minutos para não poluir o log.
    if (due > 0 && Date.now() - lastNoConnectionWarn > 5 * 60_000) {
      lastNoConnectionWarn = Date.now();
      deps.logger.warn({ due }, "há cobranças vencidas, mas o WhatsApp não está conectado");
    }
    result.skippedNoConnection = true;
    return result;
  }

  const sleep = deps.sleep ?? defaultSleep;
  const batch = deps.batchSize ?? 20;
  while (result.processed < batch && !deps.shouldStop?.() && deps.isConnected()) {
    const chargeId = await claimNextCharge(deps.instanceId);
    if (!chargeId) break;
    if (result.processed === 0) deps.logger.info("cobranças vencidas encontradas; iniciando envios");
    const outcome = await processCharge(chargeId, deps);
    result.processed++;
    result.outcomes[outcome] = (result.outcomes[outcome] ?? 0) + 1;
    await deps.onProgress?.().catch((err) => deps.logger.warn({ err }, "falha ao registrar progresso"));
    if (outcome === "released") break; // conexão caiu: espera o próximo ciclo
    // Intervalo entre envios consecutivos (ritmo humano, sem rajadas).
    if (outcome === "sent" || outcome === "unknown") await sleep(deps.minIntervalMs);
  }
  if (result.processed > 0) deps.logger.info(result.outcomes, "ciclo de envio concluído");
  return result;
}

/** Retenção (LGPD): apaga tentativas antigas e comandos já processados. */
export async function runRetention(retentionDays: number, logger: Logger) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60_000);
  const { count: attempts } = await prisma.messageAttempt.deleteMany({
    where: { attemptedAt: { lt: cutoff }, status: { not: "STARTED" } },
  });
  const { count: commands } = await prisma.systemCommand.deleteMany({
    where: { status: { in: ["DONE", "FAILED"] }, createdAt: { lt: new Date(Date.now() - 30 * 24 * 60 * 60_000) } },
  });
  if (attempts || commands) logger.info({ attempts, commands, retentionDays }, "retenção aplicada");
}
