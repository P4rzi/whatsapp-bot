import type { ChargeStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { localToUtc } from "@/lib/utils/datetime";
import { parseMoney } from "@/lib/utils/money";
import type { ChargeFormValues } from "./charge.schema";

export class ChargeError extends Error {}

export const CHARGE_PAGE_SIZE = 50;

export async function listCharges(opts: { status?: ChargeStatus; page?: number }) {
  const page = Math.max(1, opts.page ?? 1);
  const where = opts.status ? { status: opts.status } : {};
  const [items, total] = await Promise.all([
    prisma.charge.findMany({
      where,
      // Agendadas: as próximas primeiro. Demais: as mais recentes primeiro.
      orderBy: { scheduledAt: opts.status === "PENDING" ? "asc" : "desc" },
      skip: (page - 1) * CHARGE_PAGE_SIZE,
      take: CHARGE_PAGE_SIZE,
      include: { customer: { select: { id: true, name: true, phone: true } } },
    }),
    prisma.charge.count({ where }),
  ]);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / CHARGE_PAGE_SIZE)) };
}

export async function createCharge(values: ChargeFormValues) {
  const scheduledAt = localToUtc(values.date, values.time);
  if (!scheduledAt) throw new ChargeError("Data ou horário inválido");

  const customer = await prisma.customer.findUnique({
    where: { id: values.customerId },
    select: { isActive: true, consentAt: true, optedOutAt: true },
  });
  if (!customer) throw new ChargeError("Cliente não encontrado");
  if (!customer.isActive) throw new ChargeError("Este cliente está inativo. Ative-o antes de agendar cobranças.");
  if (customer.optedOutAt) throw new ChargeError("Este cliente pediu para não receber mensagens.");
  if (!customer.consentAt) {
    throw new ChargeError("Registre a autorização do cliente (LGPD) no cadastro dele antes de agendar cobranças.");
  }

  return prisma.charge.create({
    data: {
      customerId: values.customerId,
      description: values.description,
      amount: parseMoney(values.amount),
      message: values.message,
      scheduledAt,
    },
  });
}

/**
 * Cancela uma cobrança ainda não processada. A condição no UPDATE garante que uma cobrança
 * que o worker acabou de reservar (PROCESSING) não seja cancelada no meio do envio.
 */
export async function cancelCharge(id: string) {
  const { count } = await prisma.charge.updateMany({
    where: { id, status: "PENDING" },
    data: { status: "CANCELLED", cancelledAt: new Date() },
  });
  if (count === 0) {
    throw new ChargeError("Só é possível cancelar cobranças agendadas que ainda não começaram a ser enviadas.");
  }
}
