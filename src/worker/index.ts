import { randomUUID } from "node:crypto";
import path from "node:path";
import { parseKey } from "@/lib/crypto";
import { getWorkerEnv } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { expireStaleCommands } from "@/modules/whatsapp/command.repository";
import { prismaConnectionStore } from "@/modules/whatsapp/connection.repository";
import { processCommands } from "./commands";
import { BaileysProvider } from "./whatsapp/client";
import { ConnectionManager } from "./whatsapp/connection";
import { acquireSessionLock } from "./whatsapp/session";

// Processo 2 — Worker: mantém a conexão do WhatsApp e (Etapa 4) processa a fila de cobranças.
// Roda continuamente, independente do painel. Comunicação com o painel só pelo banco.

const logger = createLogger("worker");
const instanceId = randomUUID();

/** Intervalo de leitura de comandos do painel (conectar/desconectar): curto para o painel responder rápido. */
const COMMAND_POLL_MS = 2_000;
/** Intervalo do batimento (heartbeat) usado nos health checks. */
const HEARTBEAT_MS = 15_000;

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

  const m = manager;
  every(COMMAND_POLL_MS, "commands", async () => {
    await processCommands(m, logger);
  });
  every(HEARTBEAT_MS, "heartbeat", () => heartbeat());
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
