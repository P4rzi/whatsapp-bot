import pino from "pino";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { retryCharge } from "@/modules/charges/charge.service";
import { MockWhatsAppProvider } from "@/modules/whatsapp/mock-provider";
import { ProviderNotConnectedError } from "@/modules/whatsapp/provider";
import { processCharge } from "@/worker/processors/message.processor";
import { claimNextCharge, recoverStuckCharges } from "@/worker/queue";
import { runRetention, runSchedulerCycle, type SchedulerDeps } from "@/worker/scheduler";
import { createTestCustomer, resetDb } from "./db";

const logger = pino({ level: "silent" });
let provider: MockWhatsAppProvider;

beforeEach(async () => {
  await resetDb();
  provider = new MockWhatsAppProvider({ hasSession: true });
  provider.simulateOpen();
});
afterAll(() => prisma.$disconnect());

function deps(overrides: Partial<SchedulerDeps> = {}): SchedulerDeps {
  return {
    provider,
    instanceId: "worker-test",
    logger,
    isConnected: () => provider.isConnected(),
    maxAttempts: 3,
    sendTimeoutMs: 300,
    minIntervalMs: 0,
    retryDelaysMs: [60_000, 120_000],
    sleep: async () => {},
    ...overrides,
  };
}

async function createCharge(customerId: string, opts: { minutesFromNow?: number; status?: "PENDING" | "CANCELLED"; amount?: string } = {}) {
  return prisma.charge.create({
    data: {
      customerId,
      description: "Mensalidade",
      amount: opts.amount ?? "150.00",
      message: "Olá {{nome}}, valor R$ {{valor}} ({{descricao}})",
      scheduledAt: new Date(Date.now() + (opts.minutesFromNow ?? -1) * 60_000),
      status: opts.status ?? "PENDING",
    },
  });
}

const get = (id: string) => prisma.charge.findUniqueOrThrow({ where: { id }, include: { attempts: { orderBy: { attemptNumber: "asc" } } } });

describe("processamento da fila", () => {
  it("envia a cobrança vencida com a mensagem preenchida e registra o histórico", async () => {
    const c = await createTestCustomer({ name: "Maria" });
    const ch = await createCharge(c.id);
    const r = await runSchedulerCycle(deps());
    expect(r.outcomes.sent).toBe(1);

    expect(provider.sent).toEqual([
      { recipient: "5511987654321@s.whatsapp.net", text: "Olá Maria, valor R$ 150,00 (Mensalidade)", id: "MSG-1" },
    ]);
    const after = await get(ch.id);
    expect(after.status).toBe("SENT");
    expect(after.sentAt).toBeInstanceOf(Date);
    expect(after.lockedBy).toBeNull();
    expect(after.attempts).toHaveLength(1);
    expect(after.attempts[0]).toMatchObject({ status: "SUCCESS", attemptNumber: 1, providerMessageId: "MSG-1" });
    expect(after.attempts[0].renderedMessage).toBe("Olá Maria, valor R$ 150,00 (Mensalidade)");
  });

  it("não envia cobranças futuras nem canceladas", async () => {
    const c = await createTestCustomer();
    const future = await createCharge(c.id, { minutesFromNow: 30 });
    const cancelled = await createCharge(c.id, { status: "CANCELLED" });
    await runSchedulerCycle(deps());
    expect(provider.sent).toHaveLength(0);
    expect((await get(future.id)).status).toBe("PENDING");
    expect((await get(cancelled.id)).status).toBe("CANCELLED");
  });

  it("não processa nada sem WhatsApp conectado", async () => {
    const c = await createTestCustomer();
    const ch = await createCharge(c.id);
    provider.simulateClose({ kind: "transient" });
    const r = await runSchedulerCycle(deps());
    expect(r.skippedNoConnection).toBe(true);
    expect((await get(ch.id)).status).toBe("PENDING");
  });

  it("envia na ordem do horário agendado", async () => {
    const c = await createTestCustomer();
    const later = await createCharge(c.id, { minutesFromNow: -1, amount: "2.00" });
    const earlier = await createCharge(c.id, { minutesFromNow: -10, amount: "1.00" });
    await runSchedulerCycle(deps());
    expect(provider.sent.map((s) => s.text)).toEqual([expect.stringContaining("1,00"), expect.stringContaining("2,00")]);
    expect((await get(earlier.id)).status).toBe("SENT");
    expect((await get(later.id)).status).toBe("SENT");
  });
});

describe("regras de envio (LGPD e cadastro)", () => {
  it.each([
    ["inativo", { isActive: false }, "Cliente inativo."],
    ["descadastrado", { optedOut: true }, "Cliente pediu para não receber mensagens."],
    ["sem autorização", { consent: false }, "Cliente sem autorização registrada para receber mensagens."],
  ])("cliente %s: não envia e registra o motivo", async (_, customer, reason) => {
    const c = await createTestCustomer(customer);
    const ch = await createCharge(c.id);
    await runSchedulerCycle(deps());
    expect(provider.sent).toHaveLength(0);
    const after = await get(ch.id);
    expect(after.status).toBe("FAILED");
    expect(after.lastError).toBe(reason);
    expect(after.attempts[0]).toMatchObject({ status: "FAILED", errorMessage: reason });
  });

  it("número sem WhatsApp: falha definitiva, sem nova tentativa", async () => {
    const c = await createTestCustomer();
    provider.notOnWhatsApp.add(c.phone);
    const ch = await createCharge(c.id);
    await runSchedulerCycle(deps());
    const after = await get(ch.id);
    expect(after.status).toBe("FAILED");
    expect(after.lastError).toMatch(/não tem WhatsApp/);
    expect(after.nextAttemptAt).toBeNull();
  });
});

describe("tentativas e backoff", () => {
  it("falha antes do envio agenda nova tentativa com espera, e não repete antes da hora", async () => {
    const c = await createTestCustomer();
    const ch = await createCharge(c.id);
    provider.failNextResolve = new Error("instabilidade");
    const r = await runSchedulerCycle(deps());
    expect(r.outcomes.retry_scheduled).toBe(1);

    let after = await get(ch.id);
    expect(after.status).toBe("PENDING");
    expect(after.attemptCount).toBe(1);
    expect(after.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now() + 50_000);

    await runSchedulerCycle(deps()); // ainda não chegou a hora
    expect(provider.sent).toHaveLength(0);

    await prisma.charge.update({ where: { id: ch.id }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
    await runSchedulerCycle(deps());
    after = await get(ch.id);
    expect(after.status).toBe("SENT");
    expect(after.attempts.map((a) => a.status)).toEqual(["FAILED", "SUCCESS"]);
    expect(provider.sent).toHaveLength(1);
  });

  it("para no limite de tentativas", async () => {
    const c = await createTestCustomer();
    const ch = await createCharge(c.id);
    for (let i = 0; i < 3; i++) {
      provider.failNextResolve = new Error("instabilidade");
      await prisma.charge.updateMany({ where: { id: ch.id, status: "PENDING" }, data: { nextAttemptAt: new Date(Date.now() - 1000) } });
      await runSchedulerCycle(deps());
    }
    const after = await get(ch.id);
    expect(after.status).toBe("FAILED");
    expect(after.lastError).toMatch(/limite de 3 tentativas/);
    expect(after.attempts).toHaveLength(3);
  });

  it("desconexão recusada antes do envio é segura para tentar de novo", async () => {
    const c = await createTestCustomer();
    const ch = await createCharge(c.id);
    provider.failNextSend = new ProviderNotConnectedError();
    await runSchedulerCycle(deps());
    const after = await get(ch.id);
    expect(after.status).toBe("PENDING");
    expect(after.attempts[0].status).toBe("FAILED");
  });
});

describe("proteção contra mensagens duplicadas", () => {
  it("timeout no envio: resultado desconhecido, FAILED e nunca reenviado automaticamente", async () => {
    const c = await createTestCustomer();
    const ch = await createCharge(c.id);
    provider.hangNextSend = true;
    const r = await runSchedulerCycle(deps());
    expect(r.outcomes.unknown).toBe(1);

    const after = await get(ch.id);
    expect(after.status).toBe("FAILED");
    expect(after.attempts[0].status).toBe("UNKNOWN");
    expect(after.lastError).toMatch(/Resultado desconhecido/);

    for (let i = 0; i < 3; i++) await runSchedulerCycle(deps());
    expect(await prisma.messageAttempt.count({ where: { chargeId: ch.id } })).toBe(1);
  });

  it("erro durante o envio também é tratado como resultado desconhecido", async () => {
    const c = await createTestCustomer();
    const ch = await createCharge(c.id);
    provider.failNextSend = new Error("Connection Closed");
    await runSchedulerCycle(deps());
    const after = await get(ch.id);
    expect(after.status).toBe("FAILED");
    expect(after.attempts[0].status).toBe("UNKNOWN");
  });

  it("duas execuções ao mesmo tempo enviam cada cobrança exatamente uma vez", async () => {
    const c = await createTestCustomer();
    for (let i = 0; i < 12; i++) await createCharge(c.id, { amount: `${i + 1}.00` });
    await Promise.all([
      runSchedulerCycle(deps({ instanceId: "worker-A" })),
      runSchedulerCycle(deps({ instanceId: "worker-B" })),
      runSchedulerCycle(deps({ instanceId: "worker-C" })),
    ]);
    expect(provider.sent).toHaveLength(12);
    expect(new Set(provider.sent.map((s) => s.text)).size).toBe(12);
    expect(await prisma.charge.count({ where: { status: "SENT" } })).toBe(12);
    expect(await prisma.messageAttempt.count()).toBe(12);
  });

  it("reserva é exclusiva: a mesma cobrança não é entregue a duas instâncias", async () => {
    const c = await createTestCustomer();
    await createCharge(c.id);
    const claims = await Promise.all(Array.from({ length: 8 }, (_, i) => claimNextCharge(`w${i}`)));
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("instância que não é dona da reserva não processa", async () => {
    const c = await createTestCustomer();
    const ch = await createCharge(c.id);
    await claimNextCharge("worker-A");
    expect(await processCharge(ch.id, deps({ instanceId: "worker-B" }))).toBe("skipped");
    expect(provider.sent).toHaveLength(0);
  });
});

describe("recuperação após queda ou reinício do worker", () => {
  it("cobrança presa sem tentativa iniciada volta para a fila e é enviada uma vez", async () => {
    const c = await createTestCustomer();
    const ch = await createCharge(c.id);
    await claimNextCharge("worker-morto");
    expect(await recoverStuckCharges({ exceptInstance: "worker-novo" })).toEqual({ requeued: 1, unknown: 0 });
    await runSchedulerCycle(deps({ instanceId: "worker-novo" }));
    expect((await get(ch.id)).status).toBe("SENT");
    expect(provider.sent).toHaveLength(1);
  });

  it("cobrança presa com envio iniciado NÃO é reenviada: vira resultado desconhecido", async () => {
    const c = await createTestCustomer();
    const ch = await createCharge(c.id);
    await claimNextCharge("worker-morto");
    await prisma.messageAttempt.create({ data: { chargeId: ch.id, attemptNumber: 1, status: "STARTED" } });

    expect(await recoverStuckCharges({ exceptInstance: "worker-novo" })).toEqual({ requeued: 0, unknown: 1 });
    await runSchedulerCycle(deps({ instanceId: "worker-novo" }));
    const after = await get(ch.id);
    expect(after.status).toBe("FAILED");
    expect(after.attempts[0].status).toBe("UNKNOWN");
    expect(provider.sent).toHaveLength(0);
  });

  it("cobrança travada há muito tempo é recuperada pelo ciclo normal (timeout)", async () => {
    const c = await createTestCustomer();
    const ch = await createCharge(c.id);
    await claimNextCharge("worker-test");
    await prisma.charge.update({ where: { id: ch.id }, data: { lockedAt: new Date(Date.now() - 10 * 60_000) } });
    await runSchedulerCycle(deps());
    expect((await get(ch.id)).status).toBe("SENT");
  });

  it("cobrança em processamento recente de outra instância não é tocada pelo timeout", async () => {
    const c = await createTestCustomer();
    const ch = await createCharge(c.id);
    await claimNextCharge("worker-vivo");
    expect(await recoverStuckCharges()).toEqual({ requeued: 0, unknown: 0 });
    expect((await get(ch.id)).status).toBe("PROCESSING");
  });

  it("cobranças pendentes acumuladas enquanto o worker estava fora são enviadas ao voltar", async () => {
    const c = await createTestCustomer();
    for (let i = 0; i < 3; i++) await createCharge(c.id, { minutesFromNow: -60 * (i + 1) });
    await runSchedulerCycle(deps({ instanceId: "worker-reiniciado" }));
    expect(provider.sent).toHaveLength(3);
  });
});

describe("reenvio manual e retenção", () => {
  it("reenvio manual devolve a cobrança para a fila e numera a nova tentativa", async () => {
    const c = await createTestCustomer();
    const ch = await createCharge(c.id);
    provider.hangNextSend = true;
    await runSchedulerCycle(deps());
    await retryCharge(ch.id);
    await runSchedulerCycle(deps());
    const after = await get(ch.id);
    expect(after.status).toBe("SENT");
    expect(after.attempts.map((a) => [a.attemptNumber, a.status])).toEqual([
      [1, "UNKNOWN"],
      [2, "SUCCESS"],
    ]);
  });

  it("retenção apaga tentativas antigas e mantém as recentes", async () => {
    const c = await createTestCustomer();
    const ch = await createCharge(c.id);
    await prisma.messageAttempt.create({
      data: { chargeId: ch.id, attemptNumber: 1, status: "FAILED", attemptedAt: new Date(Date.now() - 200 * 86_400_000) },
    });
    await prisma.messageAttempt.create({ data: { chargeId: ch.id, attemptNumber: 2, status: "SUCCESS" } });
    await runRetention(180, logger);
    const left = await prisma.messageAttempt.findMany();
    expect(left.map((a) => a.attemptNumber)).toEqual([2]);
  });
});

describe("cobranças muito atrasadas", () => {
  it("não envia sozinha cobrança que passou do atraso máximo", async () => {
    const c = await createTestCustomer();
    const ch = await createCharge(c.id, { minutesFromNow: -5 * 24 * 60 }); // 5 dias atrás
    await runSchedulerCycle(deps({ maxDelayMs: 72 * 3_600_000 }));
    const after = await get(ch.id);
    expect(after.status).toBe("FAILED");
    expect(after.lastError).toMatch(/passou mais de 72h/);
    expect(provider.sent).toHaveLength(0);
  });

  it("envia normalmente se estiver dentro do limite", async () => {
    const c = await createTestCustomer();
    const ch = await createCharge(c.id, { minutesFromNow: -60 });
    await runSchedulerCycle(deps({ maxDelayMs: 72 * 3_600_000 }));
    expect((await get(ch.id)).status).toBe("SENT");
  });

  it("reenvio manual de uma cobrança atrasada é enviado (a referência passa a ser o reenvio)", async () => {
    const c = await createTestCustomer();
    const ch = await createCharge(c.id, { minutesFromNow: -5 * 24 * 60 });
    await runSchedulerCycle(deps({ maxDelayMs: 72 * 3_600_000 }));
    await retryCharge(ch.id);
    await runSchedulerCycle(deps({ maxDelayMs: 72 * 3_600_000 }));
    expect((await get(ch.id)).status).toBe("SENT");
  });
});

describe("provedor simulado (modo desenvolvimento)", () => {
  it("gera QR e conecta sozinho depois do tempo configurado", async () => {
    const dev = new MockWhatsAppProvider({ autoScanAfterMs: 20 });
    const events: string[] = [];
    dev.on("qr", () => events.push("qr"));
    dev.on("open", () => events.push("open"));
    await dev.start();
    await new Promise((r) => setTimeout(r, 60));
    expect(events).toEqual(["qr", "open"]);
    expect(dev.isConnected()).toBe(true);
  });
});

describe("batimento durante lotes longos", () => {
  it("avisa progresso a cada cobrança processada", async () => {
    const c = await createTestCustomer();
    for (let i = 0; i < 3; i++) await createCharge(c.id, { amount: `${i + 1}.00` });
    let ticks = 0;
    await runSchedulerCycle(deps({ onProgress: async () => void ticks++ }));
    expect(ticks).toBe(3);
  });

  it("falha ao registrar progresso não interrompe os envios", async () => {
    const c = await createTestCustomer();
    for (let i = 0; i < 2; i++) await createCharge(c.id, { amount: `${i + 1}.00` });
    await runSchedulerCycle(deps({ onProgress: async () => { throw new Error("banco instável"); } }));
    expect(provider.sent).toHaveLength(2);
  });
});

describe("numeração das tentativas", () => {
  it("continua do maior número mesmo depois que a retenção apagou tentativas antigas", async () => {
    const c = await createTestCustomer();
    const ch = await createCharge(c.id);
    // Histórico: tentativa 1 (antiga, apagada pela retenção) e tentativa 2 (recente, mantida).
    await prisma.messageAttempt.create({ data: { chargeId: ch.id, attemptNumber: 1, status: "FAILED", attemptedAt: new Date(Date.now() - 200 * 86_400_000) } });
    await prisma.messageAttempt.create({ data: { chargeId: ch.id, attemptNumber: 2, status: "FAILED" } });
    await runRetention(180, logger);
    expect(await prisma.messageAttempt.count({ where: { chargeId: ch.id } })).toBe(1);

    await runSchedulerCycle(deps());
    const after = await get(ch.id);
    expect(after.status).toBe("SENT");
    expect(after.attempts.map((a) => a.attemptNumber)).toEqual([2, 3]);
  });
});
