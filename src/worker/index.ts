import { randomUUID } from "node:crypto";
import { getWorkerEnv } from "@/lib/env";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";

// Processo 2 — Worker.
// Etapa 1: esqueleto com batimento (heartbeat) e encerramento gracioso.
// WhatsApp (Etapa 3) e fila de cobranças (Etapa 4) entram aqui depois.

const logger = createLogger("worker");
const instanceId = randomUUID();
let stopping = false;
let timer: NodeJS.Timeout | undefined;

async function cycle() {
  const startedAt = Date.now();
  // (Etapa 4) processar comandos e fila aqui.
  const elapsed = Date.now() - startedAt;
  await prisma.workerHeartbeat.upsert({
    where: { id: "worker" },
    create: { id: "worker", instanceId, startedAt: new Date(), lastCycleAt: new Date(), lastCycleMs: elapsed },
    update: { instanceId, lastCycleAt: new Date(), lastCycleMs: elapsed },
  });
}

async function loop(intervalMs: number) {
  if (stopping) return;
  try {
    await cycle();
  } catch (err) {
    logger.error({ err }, "falha no ciclo do worker");
  }
  if (!stopping) timer = setTimeout(() => void loop(intervalMs), intervalMs);
}

async function main() {
  const env = getWorkerEnv();
  logger.info({ instanceId, pollIntervalMs: env.WORKER_POLL_INTERVAL_MS }, "worker iniciado");

  await prisma.workerHeartbeat.upsert({
    where: { id: "worker" },
    create: { id: "worker", instanceId, startedAt: new Date(), lastCycleAt: new Date() },
    update: { instanceId, startedAt: new Date(), lastCycleAt: new Date() },
  });

  void loop(env.WORKER_POLL_INTERVAL_MS);
}

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, "encerrando worker");
  if (timer) clearTimeout(timer);
  try {
    await prisma.$disconnect();
  } finally {
    logger.info("worker encerrado");
    process.exit(0);
  }
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (err) => logger.error({ err }, "promise rejeitada sem tratamento"));

main().catch((err) => {
  logger.fatal({ err }, "falha ao iniciar o worker");
  process.exit(1);
});
