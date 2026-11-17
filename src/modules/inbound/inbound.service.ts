import { Prisma } from "@/generated/prisma/client";
import type { InboundIntent } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import type { IncomingMessage } from "@/modules/whatsapp/provider";
import { classifyInbound, phoneVariants } from "./classify";

// Respostas dos clientes. Só registra mensagens de clientes cadastrados (privacidade: mensagens de
// outras pessoas que escrevem para o número do Amauri não são guardadas).

export type RecordResult = "recorded" | "duplicate" | "unknown_sender";

export async function recordInbound(msg: IncomingMessage): Promise<{ result: RecordResult; intent?: InboundIntent }> {
  const customer = await prisma.customer.findFirst({
    where: { phone: { in: phoneVariants(msg.phone) } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!customer) return { result: "unknown_sender" };

  const intent = classifyInbound(msg.text, msg.kind);
  try {
    await prisma.inboundMessage.create({
      data: {
        customerId: customer.id,
        providerMessageId: msg.providerMessageId,
        kind: msg.kind,
        text: msg.text,
        intent,
        receivedAt: msg.receivedAt,
      },
    });
  } catch (err) {
    // A mesma mensagem pode chegar duas vezes (reconexão): o ID único evita duplicar.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return { result: "duplicate" };
    throw err;
  }
  return { result: "recorded", intent };
}

export const INBOUND_FILTERS = ["nao-vistas", "parar", "pagamento", "todas"] as const;
export type InboundFilter = (typeof INBOUND_FILTERS)[number];
export const INBOUND_PAGE_SIZE = 50;

export async function listInbound(filter: InboundFilter, page = 1) {
  const where: Prisma.InboundMessageWhereInput = {
    ...(filter === "nao-vistas" && { handledAt: null }),
    ...(filter === "parar" && { intent: "OPT_OUT" }),
    ...(filter === "pagamento" && { intent: "PAYMENT_CLAIM" }),
  };
  const current = Math.max(1, page);
  const [items, total] = await Promise.all([
    prisma.inboundMessage.findMany({
      where,
      orderBy: { receivedAt: "desc" },
      skip: (current - 1) * INBOUND_PAGE_SIZE,
      take: INBOUND_PAGE_SIZE,
      include: { customer: { select: { id: true, name: true, phone: true, optedOutAt: true } } },
    }),
    prisma.inboundMessage.count({ where }),
  ]);
  return { items, total, page: current, pages: Math.max(1, Math.ceil(total / INBOUND_PAGE_SIZE)) };
}

export async function countUnhandledInbound() {
  const [total, optOut] = await Promise.all([
    prisma.inboundMessage.count({ where: { handledAt: null } }),
    prisma.inboundMessage.count({ where: { handledAt: null, intent: "OPT_OUT" } }),
  ]);
  return { total, optOut };
}

export function recentInboundForCustomer(customerId: string, take = 20) {
  return prisma.inboundMessage.findMany({ where: { customerId }, orderBy: { receivedAt: "desc" }, take });
}

export async function markInboundHandled(id: string) {
  await prisma.inboundMessage.updateMany({ where: { id, handledAt: null }, data: { handledAt: new Date() } });
}

export async function markAllInboundHandled() {
  const { count } = await prisma.inboundMessage.updateMany({ where: { handledAt: null }, data: { handledAt: new Date() } });
  return count;
}

/**
 * Descadastro confirmado pelo usuário a partir de um pedido do cliente: marca "pediu para não
 * receber", cancela as cobranças ainda agendadas e marca as respostas dele como vistas.
 */
export async function optOutFromInbound(customerId: string) {
  return prisma.$transaction(async (tx) => {
    const now = new Date();
    await tx.customer.updateMany({ where: { id: customerId, optedOutAt: null }, data: { optedOutAt: now } });
    const { count: cancelled } = await tx.charge.updateMany({
      where: { customerId, status: "PENDING" },
      data: { status: "CANCELLED", cancelledAt: now },
    });
    await tx.inboundMessage.updateMany({ where: { customerId, handledAt: null }, data: { handledAt: now } });
    return { cancelled };
  });
}
