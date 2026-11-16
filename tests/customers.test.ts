import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { customerFormSchema, emptyCustomerForm } from "@/modules/customers/customer.schema";
import { createCustomer, CustomerError, deleteCustomer, DuplicatePhoneError, updateCustomer } from "@/modules/customers/customer.service";
import { createTestCustomer, resetDb } from "./db";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const valid = { ...emptyCustomerForm, name: "João Silva", phone: "(21) 99876-5432" };

describe("validação do cadastro de clientes", () => {
  it("aceita dados válidos", () => {
    expect(customerFormSchema.safeParse(valid).success).toBe(true);
  });
  it("rejeita telefone inválido", () => {
    expect(customerFormSchema.safeParse({ ...valid, phone: "123" }).success).toBe(false);
  });
  it("exige a origem quando há autorização", () => {
    const r = customerFormSchema.safeParse({ ...valid, consent: true, consentSource: "" });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["consentSource"]);
  });
});

describe("cadastro de clientes", () => {
  it("salva o telefone normalizado e registra a data da autorização", async () => {
    const c = await createCustomer({ ...valid, consent: true, consentSource: "Contrato" });
    expect(c.phone).toBe("5521998765432");
    expect(c.consentAt).toBeInstanceOf(Date);
    expect(c.consentSource).toBe("Contrato");
    expect(c.optedOutAt).toBeNull();
  });

  it("mantém a data original da autorização ao editar", async () => {
    const c = await createCustomer({ ...valid, consent: true, consentSource: "Contrato" });
    const updated = await updateCustomer(c.id, { ...valid, name: "João S.", consent: true, consentSource: "Contrato" });
    expect(updated.name).toBe("João S.");
    expect(updated.consentAt?.getTime()).toBe(c.consentAt?.getTime());
  });

  it("registra descadastro e remoção da autorização", async () => {
    const c = await createCustomer({ ...valid, consent: true, consentSource: "WhatsApp" });
    const updated = await updateCustomer(c.id, { ...valid, consent: false, optedOut: true });
    expect(updated.consentAt).toBeNull();
    expect(updated.optedOutAt).toBeInstanceOf(Date);
  });
});

describe("telefone duplicado", () => {
  it("não deixa cadastrar dois clientes com o mesmo telefone (em qualquer formato)", async () => {
    await createCustomer({ ...valid, phone: "(21) 99876-5432" });
    await expect(createCustomer({ ...valid, name: "Outro", phone: "+55 21 99876-5432" })).rejects.toBeInstanceOf(
      DuplicatePhoneError,
    );
    expect(await prisma.customer.count()).toBe(1);
  });

  it("deixa editar o próprio cliente sem acusar duplicidade, mas não trocar para o telefone de outro", async () => {
    const a = await createCustomer({ ...valid, phone: "(21) 99876-5432" });
    const b = await createCustomer({ ...valid, name: "B", phone: "(21) 99876-0000" });
    await expect(updateCustomer(a.id, { ...valid, name: "A editado", phone: "(21) 99876-5432" })).resolves.toBeTruthy();
    await expect(updateCustomer(b.id, { ...valid, name: "B", phone: "(21) 99876-5432" })).rejects.toBeInstanceOf(
      DuplicatePhoneError,
    );
  });
});

describe("exclusão de clientes", () => {
  it("bloqueia se houver cobrança pendente", async () => {
    const c = await createTestCustomer();
    await prisma.charge.create({
      data: { customerId: c.id, description: "x", message: "y", scheduledAt: new Date(Date.now() + 3600_000) },
    });
    await expect(deleteCustomer(c.id)).rejects.toBeInstanceOf(CustomerError);
    expect(await prisma.customer.count()).toBe(1);
  });

  it("bloqueia se houver cobrança em envio", async () => {
    const c = await createTestCustomer();
    await prisma.charge.create({
      data: { customerId: c.id, description: "x", message: "y", scheduledAt: new Date(), status: "PROCESSING" },
    });
    await expect(deleteCustomer(c.id)).rejects.toBeInstanceOf(CustomerError);
  });

  it("apaga cliente, cobranças e tentativas quando não há nada em andamento", async () => {
    const c = await createTestCustomer();
    const ch = await prisma.charge.create({
      data: { customerId: c.id, description: "x", message: "y", scheduledAt: new Date(), status: "SENT" },
    });
    await prisma.messageAttempt.create({ data: { chargeId: ch.id, attemptNumber: 1, status: "SUCCESS" } });
    await deleteCustomer(c.id);
    expect(await prisma.customer.count()).toBe(0);
    expect(await prisma.charge.count()).toBe(0);
    expect(await prisma.messageAttempt.count()).toBe(0);
  });
});
