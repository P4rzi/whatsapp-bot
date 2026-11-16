import { prisma } from "@/lib/prisma";

// Saúde do sistema, usada pelos endpoints /api/health e pelo painel.
// O worker só é considerado saudável se o último ciclo for recente.

export type HealthReport = {
  ok: boolean;
  web: "ok";
  database: "ok" | "error";
  worker: "ok" | "stale" | "unknown";
  whatsapp: string;
  checkedAt: string;
};

/** Ciclo do worker mais antigo que isso indica worker parado ou travado. */
const WORKER_STALE_MS = Number(process.env.WORKER_STALE_MS ?? 120_000);

export async function getHealthReport(): Promise<HealthReport> {
  const checkedAt = new Date();
  let database: HealthReport["database"] = "ok";
  let worker: HealthReport["worker"] = "unknown";
  let whatsapp = "UNKNOWN";

  try {
    const [heartbeat, connection] = await Promise.all([
      prisma.workerHeartbeat.findUnique({ where: { id: "worker" } }),
      prisma.whatsAppConnection.findUnique({ where: { instance: "default" }, select: { status: true } }),
    ]);
    if (heartbeat) {
      worker = checkedAt.getTime() - heartbeat.lastCycleAt.getTime() <= WORKER_STALE_MS ? "ok" : "stale";
    }
    whatsapp = connection?.status ?? "DISCONNECTED";
  } catch {
    database = "error";
  }

  return {
    ok: database === "ok" && worker === "ok" && whatsapp === "CONNECTED",
    web: "ok",
    database,
    worker,
    whatsapp,
    checkedAt: checkedAt.toISOString(),
  };
}
