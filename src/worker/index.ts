import { randomUUID } from "node:crypto";
import path from "node:path";
import { parseKey } from "@/lib/crypto";
import { getWorkerEnv } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { expireStaleCommands } from "@/modules/whatsapp/command.repository";
import { prismaConnectionStore } from "@/modules/whatsapp/connection.repository";
import { processCommands } from "./commands";
import { recoverStuckCharges } from "./queue";
import { runRetention, runSchedulerCycle } from "./scheduler";
import { BaileysProvider } from "./whatsapp/client";
import { ConnectionManager } from "./whatsapp/connection";
import { acquireSessionLock } from "./whatsapp/session";

// Processo 2 — Worker: mantém a conexão do WhatsApp e processa a fila de cobranças.
// Roda continuamente, independente do painel. Comunicação com o painel só pelo banco.

const logger = createLogger("worker");
const instanceId = randomUUID();

/** Intervalo de leitura de comandos do painel (conectar/desconectar): curto para o painel responder rápido. */
const COMMAND_POLL_MS = 2_000;
/** Intervalo da limpeza de dados antigos (retenção). */
const RETENTION_EVERY_MS = 6 * 60 * 60_000;

let stopping = false;
const timers: NodeJS.Timeout[] = [];
let releaseLock: (() => Promise<void>) | null = null;
let manager: ConnectionManager | null = null;

async function heartbeat(cycleMs = 0) {
  const now = new Date();
  await prisma.workerHeartbeat.upsert({
    where: { id: "worker" },
    create: { id: "worker", instanceId, startedAt: now, lastCycleAt: now, lastCycleMs: cycleMs },
    update: { instanceId, lastCycleAt: now, lastCycleMs: cycleMs },
  });
}

/** Executa fn a cada intervalMs, sem sobrepor execuções e sem derrubar o processo em caso de erro. */
function every(intervalMs: number, name: string, fn: () => Promise<void>) {
  const tick = async () => {
    if (stopping) return;
    try {
      await fn();
    } catch (err) {
      logger.error({ err, task: name }, "falha em tarefa periódica");
    }
    if (!stopping) timers.push(setTimeout(tick, intervalMs));
  };
  void tick();
}

async function main() {
  const env = getWorkerEnv();
  const sessionPath = path.resolve(env.WHATSAPP_SESSION_PATH);
  logger.info({ instanceId, sessionPath, pollIntervalMs: env.WORKER_POLL_INTERVAL_MS }, "worker iniciado");

  releaseLock = await acquireSessionLock(sessionPath, instanceId);
  await prisma.workerHeartbeat.upsert({
    where: { id: "worker" },
    create: { id: "worker", instanceId, startedAt: new Date(), lastCycleAt: new Date() },
    update: { instanceId, startedAt: new Date(), lastCycleAt: new Date() },
  });

  const stale = await expireStaleCommands();
  if (stale.interrupted || stale.expired) logger.warn(stale, "comandos antigos descartados");

  const provider = new BaileysProvider(sessionPath, parseKey(env.ENCRYPTION_KEY), logger);
  manager = new ConnectionManager(provider, prismaConnectionStore, logger);
  await manager.init();

  // Cobranças que ficaram em PROCESSING com o worker anterior (que morreu/reiniciou).
  const recovered = await recoverStuckCharges({ exceptInstance: instanceId });
  if (recovered.requeued || recovered.unknown) logger.warn(recovered, "cobranças do worker anterior recuperadas");

  const m = manager;
  every(COMMAND_POLL_MS, "commands", async () => {
    await processCommands(m, logger);
  });

  // Ciclo de envio. O batimento é gravado ao fim de cada ciclo: o health check
  // só considera o worker saudável se os ciclos estiverem de fato acontecendo.
  every(env.WORKER_POLL_INTERVAL_MS, "scheduler", async () => {
    const started = Date.now();
    try {
      await runSchedulerCycle({
        provider,
        instanceId,
        logger,
        isConnected: () => m.isConnected(),
        maxAttempts: env.MESSAGE_MAX_ATTEMPTS,
        sendTimeoutMs: env.MESSAGE_SEND_TIMEOUT_MS,
        minIntervalMs: env.MESSAGE_MIN_INTERVAL_MS,
        shouldStop: () => stopping,
      });
    } finally {
      await heartbeat(Date.now() - started);
    }
  });

  every(RETENTION_EVERY_MS, "retention", () => runRetention(env.RETENTION_DAYS, logger));
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "encerrando worker");
  for (const t of timers) clearTimeout(t);
  // Limite de segurança: o Railway mata o processo se demorar demais.
  const force = setTimeout(() => process.exit(1), 10_000);
  force.unref();
  try {
    await manager?.shutdown();
    await releaseLock?.();
    await prisma.$disconnect();
  } finally {
    logger.info("worker encerrado");
    process.exit(0);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (err) => logger.error({ err }, "promise rejeitada sem tratamento"));

main().catch(async (err) => {
  logger.fatal({ err }, "falha ao iniciar o worker");
  await releaseLock?.().catch(() => {});
  process.exit(1);
});
