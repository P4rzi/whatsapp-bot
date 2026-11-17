import { randomUUID } from "node:crypto";
import path from "node:path";
import { parseKey } from "@/lib/crypto";
import { getWorkerEnv } from "@/lib/env";
import { createLogger, maskPhone } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { expireStaleCommands } from "@/modules/whatsapp/command.repository";
import { prismaConnectionStore } from "@/modules/whatsapp/connection.repository";
import { MockWhatsAppProvider } from "@/modules/whatsapp/mock-provider";
import type { WhatsAppProvider } from "@/modules/whatsapp/provider";
import { recordInbound } from "@/modules/inbound/inbound.service";
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

/** Execuções em andamento: o desligamento espera por elas (ex.: um envio no meio). */
const inFlight = new Set<Promise<void>>();

/** Executa fn a cada intervalMs, sem sobrepor execuções e sem derrubar o processo em caso de erro. */
function every(intervalMs: number, name: string, fn: () => Promise<void>) {
  const tick = async () => {
    if (stopping) return;
    const run = fn().catch((err) => logger.error({ err, task: name }, "falha em tarefa periódica"));
    inFlight.add(run);
    await run;
    inFlight.delete(run);
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

  // WHATSAPP_PROVIDER=mock (só fora de produção): simula o WhatsApp para testar o sistema
  // ponta a ponta sem número real. O QR é "lido" sozinho após 5 s e nada é enviado de verdade.
  const provider: WhatsAppProvider =
    env.WHATSAPP_PROVIDER === "mock"
      ? new MockWhatsAppProvider({ autoScanAfterMs: 5_000 })
      : new BaileysProvider(sessionPath, parseKey(env.ENCRYPTION_KEY), logger);
  if (env.WHATSAPP_PROVIDER === "mock") logger.warn("MODO SIMULADO: nenhuma mensagem será enviada de verdade");
  // Respostas dos clientes: só registra para o painel. Nunca responde sozinho.
  provider.on("message", (msg) => {
    recordInbound(msg)
      .then(({ result, intent }) => {
        if (result === "recorded") logger.info({ phone: maskPhone(msg.phone), kind: msg.kind, intent }, "resposta de cliente registrada");
      })
      .catch((err) => logger.error({ err }, "falha ao registrar resposta de cliente"));
  });
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
        maxDelayMs: env.MESSAGE_MAX_DELAY_HOURS * 3_600_000,
        shouldStop: () => stopping,
        onProgress: () => heartbeat(Date.now() - started),
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
  const force = setTimeout(() => process.exit(1), 15_000);
  force.unref();
  try {
    // Deixa o envio em andamento terminar (o ciclo para de pegar novas cobranças ao ver "stopping").
    if (inFlight.size > 0) {
      logger.info({ tasks: inFlight.size }, "aguardando tarefas em andamento");
      await Promise.race([Promise.allSettled([...inFlight]), new Promise((r) => setTimeout(r, 10_000))]);
    }
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
