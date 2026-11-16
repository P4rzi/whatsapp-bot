import { prisma } from "@/lib/prisma";

/** Sem ciclo do worker há mais que isso = serviço de envio parado. */
const WORKER_STALE_MS = 120_000;

export async function getDashboardData() {
  const [customers, byStatus, upcoming, connection, heartbeat] = await Promise.all([
    prisma.customer.count(),
    prisma.charge.groupBy({ by: ["status"], _count: { _all: true } }),
    prisma.charge.findMany({
      where: { status: "PENDING" },
      orderBy: { scheduledAt: "asc" },
      take: 5,
      include: { customer: { select: { id: true, name: true } } },
    }),
    prisma.whatsAppConnection.findUnique({
      where: { instance: "default" },
      select: { status: true, phoneNumber: true, lastConnectedAt: true },
    }),
    prisma.workerHeartbeat.findUnique({ where: { id: "worker" }, select: { lastCycleAt: true } }),
  ]);

  const count = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
  const workerOk = !!heartbeat && Date.now() - heartbeat.lastCycleAt.getTime() < WORKER_STALE_MS;
  return {
    workerOk,
    customers,
    pending: count("PENDING") + count("PROCESSING"),
    sent: count("SENT"),
    failed: count("FAILED"),
    upcoming,
    whatsapp: connection ?? { status: "DISCONNECTED" as const, phoneNumber: null, lastConnectedAt: null },
    workerLastCycleAt: heartbeat?.lastCycleAt ?? null,
  };
}
