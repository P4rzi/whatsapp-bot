// Roteiro de teste ponta a ponta LOCAL (worker em modo simulado rodando em outro terminal).
// Não é usado em produção. Uso: npx tsx --env-file=.env src/scripts/e2e-local.ts
import { prisma } from "@/lib/prisma";
import { utcToLocalParts } from "@/lib/utils/datetime";
import { createCharge, updateCharge } from "@/modules/charges/charge.service";
import { createCustomer } from "@/modules/customers/customer.service";
import { enqueueCommand } from "@/modules/whatsapp/command.repository";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined | false>, timeoutMs: number): Promise<T> {
  const end = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v as T;
    if (Date.now() > end) throw new Error(`Tempo esgotado esperando: ${label}`);
    await sleep(1000);
  }
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Só para desenvolvimento.");
  console.log("1) Pedindo conexão (simulada)...");
  await enqueueCommand("CONNECT_WHATSAPP");
  const conn = await waitFor("CONNECTED", async () => {
    const c = await prisma.whatsAppConnection.findUnique({ where: { instance: "default" } });
    return c?.status === "CONNECTED" ? c : null;
  }, 30_000);
  console.log("   conectado:", conn.phoneNumber, "QR apagado:", conn.qrCode === null);

  console.log("2) Cadastrando cliente de teste...");
  const customer = await createCustomer({
    name: "Cliente E2E", phone: "(11) 90000-0099", notes: "", isActive: true, consent: true, consentSource: "Contrato", optedOut: false,
  });

  console.log("3) Agendando cobrança para daqui a 1 h e editando para agora...");
  const later = utcToLocalParts(new Date(Date.now() + 3_600_000));
  const charge = await createCharge({ customerId: customer.id, description: "Teste E2E", amount: "10,00", date: later.date, time: later.time, message: "Olá {{nome}}, R$ {{valor}} ({{descricao}})" });
  const now = utcToLocalParts(new Date());
  await updateCharge(charge.id, { customerId: customer.id, description: "Teste E2E editado", amount: "12,34", date: now.date, time: now.time, message: "Olá {{nome}}, R$ {{valor}} ({{descricao}})" });

  console.log("4) Esperando o worker enviar...");
  const sent = await waitFor("SENT", async () => {
    const ch = await prisma.charge.findUnique({ where: { id: charge.id }, include: { attempts: true } });
    return ch && ch.status !== "PENDING" && ch.status !== "PROCESSING" ? ch : null;
  }, 60_000);
  console.log("   status:", sent.status, "| tentativas:", sent.attempts.length, "| texto:", sent.attempts[0]?.renderedMessage);
  console.log(JSON.stringify({ customerId: customer.id, chargeId: charge.id }));
  if (sent.status !== "SENT") process.exitCode = 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
