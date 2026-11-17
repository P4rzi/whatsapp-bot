import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { normalizePhone } from "@/lib/utils/phone";
import type { CustomerFormValues } from "./customer.schema";

// Regras de negócio de clientes. Não conhece HTTP nem sessão: quem chama já validou o acesso.

export class CustomerError extends Error {}

export const CUSTOMER_PAGE_SIZE = 50;

export async function listCustomers(search?: string, page = 1) {
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
  const current = Math.max(1, page);
  const [items, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: [{ name: "asc" }, { id: "asc" }],
      skip: (current - 1) * CUSTOMER_PAGE_SIZE,
      take: CUSTOMER_PAGE_SIZE,
      include: { _count: { select: { charges: { where: { status: { in: ["PENDING", "PROCESSING"] } } } } } },
    }),
    prisma.customer.count({ where }),
  ]);
  return { items, total, page: current, pages: Math.max(1, Math.ceil(total / CUSTOMER_PAGE_SIZE)) };
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

/** Erro de telefone já cadastrado: o formulário mostra no campo e oferece abrir o cadastro existente. */
export class DuplicatePhoneError extends CustomerError {
  constructor(readonly existing: { id: string; name: string }) {
    super(`Este telefone já está cadastrado para ${existing.name}.`);
  }
}

async function assertPhoneAvailable(phone: string, exceptId?: string) {
  const existing = await prisma.customer.findFirst({
    where: { phone, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true, name: true },
  });
  if (existing) throw new DuplicatePhoneError(existing);
}

export async function createCustomer(values: CustomerFormValues) {
  const data = toData(values);
  await assertPhoneAvailable(data.phone);
  return prisma.customer.create({ data });
}

export async function updateCustomer(id: string, values: CustomerFormValues) {
  const current = await prisma.customer.findUnique({ where: { id }, select: { consentAt: true, optedOutAt: true } });
  if (!current) throw new CustomerError("Cliente não encontrado");
  const data = toData(values, current);
  await assertPhoneAvailable(data.phone, id);
  return prisma.customer.update({ where: { id }, data });
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
