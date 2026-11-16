import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/utils/phone";
import type { CustomerFormValues } from "./customer.schema";

// Regras de negócio de clientes. Não conhece HTTP nem sessão: quem chama já validou o acesso.

export class CustomerError extends Error {}

export function listCustomers(search?: string) {
  const q = search?.trim();
  const digits = q?.replace(/\D/g, "");
  const where: Prisma.CustomerWhereInput = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" } },
          ...(digits && digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
        ],
      }
    : {};
  return prisma.customer.findMany({
    where,
    orderBy: { name: "asc" },
    take: 200,
    include: { _count: { select: { charges: { where: { status: { in: ["PENDING", "PROCESSING"] } } } } } },
  });
}

export function getCustomer(id: string) {
  return prisma.customer.findUnique({
    where: { id },
    include: { charges: { orderBy: { scheduledAt: "desc" }, take: 100 } },
  });
}

export function listActiveCustomersForSelect() {
  return prisma.customer.findMany({
    where: { isActive: true, optedOutAt: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, phone: true, consentAt: true },
  });
}

function toData(values: CustomerFormValues, current?: { consentAt: Date | null; optedOutAt: Date | null }) {
  const phone = normalizePhone(values.phone);
  if (!phone) throw new CustomerError("Telefone inválido");
  const now = new Date();
  return {
    name: values.name,
    phone,
    notes: values.notes || null,
    isActive: values.isActive,
    // Mantém a data original do consentimento/descadastro se já existia.
    consentAt: values.consent ? (current?.consentAt ?? now) : null,
    consentSource: values.consent ? values.consentSource : null,
    optedOutAt: values.optedOut ? (current?.optedOutAt ?? now) : null,
  };
}

export function createCustomer(values: CustomerFormValues) {
  return prisma.customer.create({ data: toData(values) });
}

export async function updateCustomer(id: string, values: CustomerFormValues) {
  const current = await prisma.customer.findUnique({ where: { id }, select: { consentAt: true, optedOutAt: true } });
  if (!current) throw new CustomerError("Cliente não encontrado");
  return prisma.customer.update({ where: { id }, data: toData(values, current) });
}

/**
 * Exclui o cliente e todo o seu histórico (LGPD: direito de eliminação).
 * Bloqueado se houver cobrança pendente ou em processamento.
 */
export async function deleteCustomer(id: string) {
  await prisma.$transaction(async (tx) => {
    const active = await tx.charge.count({ where: { customerId: id, status: { in: ["PENDING", "PROCESSING"] } } });
    if (active > 0) {
      throw new CustomerError(
        "Este cliente tem cobranças pendentes ou em envio. Cancele-as antes de excluir, ou apenas desative o cliente.",
      );
    }
    // Tentativas são apagadas em cascata junto com as cobranças.
    await tx.charge.deleteMany({ where: { customerId: id } });
    await tx.customer.delete({ where: { id } });
  });
}
