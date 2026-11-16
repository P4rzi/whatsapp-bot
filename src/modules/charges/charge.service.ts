import type { ChargeStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { localToUtc } from "@/lib/utils/datetime";
import { parseMoney } from "@/lib/utils/money";
import type { ChargeFormValues } from "./charge.schema";

export class ChargeError extends Error {}

export const CHARGE_PAGE_SIZE = 50;

export async function listCharges(opts: { status?: ChargeStatus; page?: number; search?: string }) {
  const page = Math.max(1, opts.page ?? 1);
  const q = opts.search?.trim();
  const where = {
    ...(opts.status ? { status: opts.status } : {}),
    ...(q
      ? {
          OR: [
            { description: { contains: q, mode: "insensitive" as const } },
            { customer: { name: { contains: q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };
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

/** Valida o formulário e o cliente (ativo, autorizado, não descadastrado) e devolve os dados da cobrança. */
async function toChargeData(values: ChargeFormValues) {
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

  return {
    customerId: values.customerId,
    description: values.description,
    amount: parseMoney(values.amount),
    message: values.message,
    scheduledAt,
  };
}

/**
 * Evita agendar duas vezes a mesma mensagem: mesmo cliente, mesmo horário e ainda ativa
 * (agendada, enviando ou enviada). Protege contra clique duplo e cadastro repetido por engano.
 */
async function assertNotDuplicate(data: { customerId: string; scheduledAt: Date }, exceptId?: string) {
  const existing = await prisma.charge.findFirst({
    where: {
      customerId: data.customerId,
      scheduledAt: data.scheduledAt,
      status: { in: ["PENDING", "PROCESSING", "SENT"] },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { description: true },
  });
  if (existing) {
    throw new ChargeError(
      `Já existe uma cobrança para este cliente nesse mesmo horário ("${existing.description}"). Escolha outro horário ou edite a existente.`,
    );
  }
}

export async function createCharge(values: ChargeFormValues) {
  const data = await toChargeData(values);
  await assertNotDuplicate(data);
  return prisma.charge.create({ data });
}

export function getCharge(id: string) {
  return prisma.charge.findUnique({ where: { id }, include: { customer: { select: { id: true, name: true } } } });
}

/**
 * Edita uma cobrança ainda agendada. A condição status=PENDING no UPDATE impede editar uma
 * cobrança que o worker acabou de reservar para envio.
 */
export async function updateCharge(id: string, values: ChargeFormValues) {
  const data = await toChargeData(values);
  await assertNotDuplicate(data, id);
  const { count } = await prisma.charge.updateMany({
    where: { id, status: "PENDING" },
    // Novo horário/mensagem = novo ciclo: zera tentativas automáticas e espera.
    data: { ...data, attemptCount: 0, nextAttemptAt: null, lastError: null },
  });
  if (count === 0) {
    throw new ChargeError("Só é possível editar cobranças agendadas que ainda não começaram a ser enviadas.");
  }
}

/**
 * Reenvio manual de uma cobrança que falhou: volta para a fila agora, com um novo ciclo de tentativas.
 * Só o usuário dispara isso (inclusive para resultado desconhecido, depois de conferir no WhatsApp).
 */
export async function retryCharge(id: string) {
  const charge = await prisma.charge.findUnique({
    where: { id },
    select: { status: true, customer: { select: { isActive: true, optedOutAt: true, consentAt: true } } },
  });
  if (!charge) throw new ChargeError("Cobrança não encontrada.");
  if (charge.status !== "FAILED") throw new ChargeError("Só é possível reenviar cobranças que falharam.");
  const c = charge.customer;
  if (!c.isActive || c.optedOutAt || !c.consentAt) {
    throw new ChargeError("O cliente está inativo, descadastrado ou sem autorização. Ajuste o cadastro antes de reenviar.");
  }
  const { count } = await prisma.charge.updateMany({
    where: { id, status: "FAILED" },
    data: { status: "PENDING", attemptCount: 0, nextAttemptAt: new Date(), lastError: null },
  });
  if (count === 0) throw new ChargeError("A cobrança mudou de status. Atualize a página.");
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
