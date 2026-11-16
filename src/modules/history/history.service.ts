import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

// Histórico de disparos: cobranças que já tiveram ao menos uma tentativa, com a última tentativa.

export const HISTORY_FILTERS = ["todos", "enviadas", "falhas", "desconhecido"] as const;
export type HistoryFilter = (typeof HISTORY_FILTERS)[number];
export const HISTORY_PAGE_SIZE = 50;

export async function listHistory(filter: HistoryFilter, page = 1) {
  const where: Prisma.ChargeWhereInput = {
    attempts: { some: {} },
    ...(filter === "enviadas" && { status: "SENT" }),
    ...(filter === "falhas" && { status: "FAILED" }),
    ...(filter === "desconhecido" && { status: "FAILED", attempts: { some: { status: "UNKNOWN" } } }),
  };
  const [items, total] = await Promise.all([
    prisma.charge.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      skip: (Math.max(1, page) - 1) * HISTORY_PAGE_SIZE,
      take: HISTORY_PAGE_SIZE,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        attempts: { orderBy: { attemptNumber: "desc" }, take: 1 },
        _count: { select: { attempts: true } },
      },
    }),
    prisma.charge.count({ where }),
  ]);
  return { items, total, pages: Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE)) };
}
