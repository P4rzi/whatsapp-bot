import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { utcToLocalParts } from "@/lib/utils/datetime";
import { chargeFormSchema, type ChargeFormValues } from "@/modules/charges/charge.schema";
import { cancelCharge, ChargeError, createCharge, listCharges, updateCharge } from "@/modules/charges/charge.service";
import { createTestCustomer, resetDb } from "./db";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

function formFor(customerId: string, overrides: Partial<ChargeFormValues> = {}): ChargeFormValues {
  const { date, time } = utcToLocalParts(new Date(Date.now() + 2 * 3600_000));
  return {
    customerId,
    description: "Mensalidade",
    amount: "150,00",
    date,
    time,
    message: "Olá {{nome}}, valor R$ {{valor}}",
    ...overrides,
  };
}

const someId = "00000000-0000-4000-8000-000000000000";

describe("validação do cadastro de cobranças", () => {
  it("aceita dados válidos", () => {
    expect(chargeFormSchema.safeParse(formFor(someId)).success).toBe(true);
  });
  it("rejeita horário no passado", () => {
    const { date, time } = utcToLocalParts(new Date(Date.now() - 3600_000));
    const r = chargeFormSchema.safeParse(formFor(someId, { date, time }));
    expect(r.success).toBe(false);
    expect(r.error?.issues.some((i) => i.path[0] === "time")).toBe(true);
  });
  it("exige valor quando a mensagem usa {{valor}}", () => {
    const r = chargeFormSchema.safeParse(formFor(someId, { amount: "" }));
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].path).toEqual(["amount"]);
  });
  it("permite sem valor quando a mensagem não usa {{valor}}", () => {
    expect(chargeFormSchema.safeParse(formFor(someId, { amount: "", message: "Oi {{nome}}" })).success).toBe(true);
  });
  it("rejeita valor inválido", () => {
    expect(chargeFormSchema.safeParse(formFor(someId, { amount: "abc" })).success).toBe(false);
  });
});

describe("cadastro de cobranças", () => {
  it("agenda em UTC, com valor decimal e status PENDING", async () => {
    const c = await createTestCustomer();
    const form = formFor(c.id, { date: "2030-03-15", time: "09:00" });
    const ch = await createCharge(form);
    expect(ch.status).toBe("PENDING");
    expect(ch.scheduledAt.toISOString()).toBe("2030-03-15T12:00:00.000Z");
    expect(ch.amount?.toString()).toBe("150");
  });

  it("recusa cliente sem autorização (LGPD)", async () => {
    const c = await createTestCustomer({ consent: false });
    await expect(createCharge(formFor(c.id))).rejects.toBeInstanceOf(ChargeError);
  });

  it("recusa cliente inativo ou descadastrado", async () => {
    const inactive = await createTestCustomer({ isActive: false, phone: "5511900000001" });
    const optedOut = await createTestCustomer({ optedOut: true, phone: "5511900000002" });
    await expect(createCharge(formFor(inactive.id))).rejects.toBeInstanceOf(ChargeError);
    await expect(createCharge(formFor(optedOut.id))).rejects.toBeInstanceOf(ChargeError);
    expect(await prisma.charge.count()).toBe(0);
  });
});

describe("cancelamento de cobranças", () => {
  it("cancela cobrança agendada", async () => {
    const c = await createTestCustomer();
    const ch = await createCharge(formFor(c.id));
    await cancelCharge(ch.id);
    const after = await prisma.charge.findUniqueOrThrow({ where: { id: ch.id } });
    expect(after.status).toBe("CANCELLED");
    expect(after.cancelledAt).toBeInstanceOf(Date);
  });

  it("não cancela cobrança que o worker já está enviando", async () => {
    const c = await createTestCustomer();
    const ch = await createCharge(formFor(c.id));
    await prisma.charge.update({ where: { id: ch.id }, data: { status: "PROCESSING" } });
    await expect(cancelCharge(ch.id)).rejects.toBeInstanceOf(ChargeError);
    expect((await prisma.charge.findUniqueOrThrow({ where: { id: ch.id } })).status).toBe("PROCESSING");
  });

  it("não cancela de novo nem cobranças já enviadas", async () => {
    const c = await createTestCustomer();
    const ch = await createCharge(formFor(c.id));
    await cancelCharge(ch.id);
    await expect(cancelCharge(ch.id)).rejects.toBeInstanceOf(ChargeError);
    await prisma.charge.update({ where: { id: ch.id }, data: { status: "SENT" } });
    await expect(cancelCharge(ch.id)).rejects.toBeInstanceOf(ChargeError);
  });
});

describe("edição de cobranças", () => {
  it("edita cobrança agendada e reinicia o ciclo de tentativas", async () => {
    const c = await createTestCustomer();
    const ch = await createCharge(formFor(c.id));
    await prisma.charge.update({
      where: { id: ch.id },
      data: { attemptCount: 2, nextAttemptAt: new Date(), lastError: "instabilidade" },
    });
    await updateCharge(ch.id, formFor(c.id, { description: "Nova descrição", amount: "99,90", date: "2030-05-01", time: "08:30" }));
    const after = await prisma.charge.findUniqueOrThrow({ where: { id: ch.id } });
    expect(after.description).toBe("Nova descrição");
    expect(after.amount?.toString()).toBe("99.9");
    expect(after.scheduledAt.toISOString()).toBe("2030-05-01T11:30:00.000Z");
    expect(after.attemptCount).toBe(0);
    expect(after.nextAttemptAt).toBeNull();
    expect(after.lastError).toBeNull();
  });

  it("não edita cobrança em envio, enviada ou cancelada", async () => {
    const c = await createTestCustomer();
    for (const [i, status] of (["PROCESSING", "SENT", "CANCELLED"] as const).entries()) {
      const ch = await createCharge(formFor(c.id, { date: "2030-07-0" + (i + 1), time: "09:00" }));
      await prisma.charge.update({ where: { id: ch.id }, data: { status } });
      await expect(updateCharge(ch.id, formFor(c.id, { description: "x" }))).rejects.toBeInstanceOf(ChargeError);
      expect((await prisma.charge.findUniqueOrThrow({ where: { id: ch.id } })).description).toBe("Mensalidade");
    }
  });

  it("recusa trocar para cliente sem autorização", async () => {
    const ok = await createTestCustomer();
    const noConsent = await createTestCustomer({ consent: false, phone: "5511900000003" });
    const ch = await createCharge(formFor(ok.id));
    await expect(updateCharge(ch.id, formFor(noConsent.id))).rejects.toBeInstanceOf(ChargeError);
  });
});

describe("cobrança duplicada", () => {
  it("não deixa agendar duas vezes para o mesmo cliente e horário", async () => {
    const c = await createTestCustomer();
    const form = formFor(c.id, { date: "2030-06-10", time: "10:00" });
    await createCharge(form);
    await expect(createCharge({ ...form, description: "Outra" })).rejects.toThrow(/mesmo horário/);
    expect(await prisma.charge.count()).toBe(1);
  });

  it("permite o mesmo horário se a anterior foi cancelada, ou para outro cliente", async () => {
    const c = await createTestCustomer();
    const other = await createTestCustomer({ phone: "5511900000004" });
    const form = formFor(c.id, { date: "2030-06-10", time: "10:00" });
    const first = await createCharge(form);
    await cancelCharge(first.id);
    await expect(createCharge(form)).resolves.toBeTruthy();
    await expect(createCharge({ ...form, customerId: other.id })).resolves.toBeTruthy();
  });

  it("editar a própria cobrança sem mudar o horário não acusa duplicidade", async () => {
    const c = await createTestCustomer();
    const form = formFor(c.id, { date: "2030-06-10", time: "10:00" });
    const ch = await createCharge(form);
    await expect(updateCharge(ch.id, { ...form, description: "Ajustada" })).resolves.toBeUndefined();
  });
});

describe("busca de cobranças", () => {
  it("encontra por nome do cliente ou descrição, sem diferenciar maiúsculas", async () => {
    const maria = await createTestCustomer({ name: "Maria Souza" });
    const joao = await createTestCustomer({ name: "João Lima", phone: "5511900000005" });
    await createCharge(formFor(maria.id, { description: "Mensalidade março", date: "2030-03-01", time: "09:00" }));
    await createCharge(formFor(joao.id, { description: "Aluguel", date: "2030-03-02", time: "09:00" }));
    expect((await listCharges({ search: "maria" })).items.map((c) => c.customer.name)).toEqual(["Maria Souza"]);
    expect((await listCharges({ search: "ALUGUEL" })).items.map((c) => c.description)).toEqual(["Aluguel"]);
    expect((await listCharges({ search: "inexistente" })).total).toBe(0);
    expect((await listCharges({ search: "" })).total).toBe(2);
  });
});
