import pino from "pino";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  countUnhandledInbound,
  listInbound,
  markAllInboundHandled,
  optOutFromInbound,
  recordInbound,
} from "@/modules/inbound/inbound.service";
import type { IncomingMessage } from "@/modules/whatsapp/provider";
import { runRetention } from "@/worker/scheduler";
import { parseIncoming, type RawMessage } from "@/worker/whatsapp/incoming";
import { createTestCustomer, resetDb } from "./db";

const logger = pino({ level: "silent" });
let seq = 0;
const msg = (o: Partial<IncomingMessage> & { phone: string }): IncomingMessage => ({
  providerMessageId: `ID-${++seq}`,
  kind: "TEXT",
  text: null,
  receivedAt: new Date(),
  ...o,
});
const noLid = async () => null;

beforeEach(() => resetDb());
afterAll(() => prisma.$disconnect());

describe("parseIncoming (formato do WhatsApp)", () => {
  const base = (key: Partial<RawMessage["key"]>, message: RawMessage["message"]): RawMessage => ({
    key: { id: "ABC", fromMe: false, remoteJid: "5511987654321@s.whatsapp.net", ...key },
    message,
    messageTimestamp: 1_763_000_000,
  });

  it("texto simples de conversa individual", async () => {
    const m = await parseIncoming(base({}, { conversation: " já paguei " }), noLid);
    expect(m).toMatchObject({ phone: "5511987654321", kind: "TEXT", text: "já paguei", providerMessageId: "ABC" });
    expect(m?.receivedAt.getTime()).toBe(1_763_000_000_000);
  });

  it("ignora grupos, status, canais e mensagens enviadas pelo próprio número", async () => {
    const text = { conversation: "oi" };
    expect(await parseIncoming(base({ remoteJid: "120363@g.us" }, text), noLid)).toBeNull();
    expect(await parseIncoming(base({ remoteJid: "status@broadcast" }, text), noLid)).toBeNull();
    expect(await parseIncoming(base({ remoteJid: "123@newsletter" }, text), noLid)).toBeNull();
    expect(await parseIncoming(base({ fromMe: true }, text), noLid)).toBeNull();
  });

  it("ignora reações, mensagens apagadas e avisos técnicos", async () => {
    expect(await parseIncoming(base({}, { reactionMessage: { text: "👍" } }), noLid)).toBeNull();
    expect(await parseIncoming(base({}, { protocolMessage: { type: 0 } }), noLid)).toBeNull();
    expect(await parseIncoming(base({}, undefined), noLid)).toBeNull();
  });

  it("identificador LID: usa o telefone alternativo ou o mapeamento", async () => {
    const lid = { remoteJid: "123456789@lid" };
    const viaAlt = await parseIncoming(base({ ...lid, remoteJidAlt: "5521999998888@s.whatsapp.net" }, { conversation: "a" }), noLid);
    expect(viaAlt?.phone).toBe("5521999998888");
    const viaMap = await parseIncoming(base(lid, { conversation: "a" }), async () => "5531988887777:3@s.whatsapp.net");
    expect(viaMap?.phone).toBe("5531988887777");
    // sem como descobrir o telefone: não registra
    expect(await parseIncoming(base(lid, { conversation: "a" }), noLid)).toBeNull();
    const failing = async (): Promise<string | null> => {
      throw new Error("x");
    };
    expect(await parseIncoming(base(lid, { conversation: "a" }), failing)).toBeNull();
  });

  it("mensagens temporárias, de visualização única, áudio, comprovante em PDF e figurinha", async () => {
    const eph = await parseIncoming(base({}, { ephemeralMessage: { message: { extendedTextMessage: { text: "pix feito" } } } }), noLid);
    expect(eph).toMatchObject({ kind: "TEXT", text: "pix feito" });
    const once = await parseIncoming(base({}, { viewOnceMessageV2: { message: { imageMessage: { caption: "comprovante" } } } }), noLid);
    expect(once).toMatchObject({ kind: "IMAGE", text: "comprovante" });
    expect(await parseIncoming(base({}, { audioMessage: {} }), noLid)).toMatchObject({ kind: "AUDIO", text: null });
    const pdf = await parseIncoming(base({}, { documentMessage: { fileName: "comprovante.pdf" } }), noLid);
    expect(pdf).toMatchObject({ kind: "DOCUMENT", text: "comprovante.pdf" });
    expect(await parseIncoming(base({}, { stickerMessage: {} }), noLid)).toMatchObject({ kind: "STICKER" });
  });

  it("corta textos muito longos", async () => {
    const m = await parseIncoming(base({}, { conversation: "a".repeat(5000) }), noLid);
    expect(m?.text).toHaveLength(2000);
  });
});

describe("recordInbound", () => {
  it("registra resposta de cliente cadastrado e classifica", async () => {
    const c = await createTestCustomer({ phone: "5511987654321" });
    const r = await recordInbound(msg({ phone: "5511987654321", text: "Já paguei hoje cedo" }));
    expect(r).toEqual({ result: "recorded", intent: "PAYMENT_CLAIM" });
    const saved = await prisma.inboundMessage.findFirstOrThrow();
    expect(saved.customerId).toBe(c.id);
  });

  it("acha o cliente mesmo com/sem o nono dígito", async () => {
    await createTestCustomer({ phone: "5511987654321" });
    expect((await recordInbound(msg({ phone: "551187654321", text: "oi" }))).result).toBe("recorded");
    await resetDb();
    await createTestCustomer({ phone: "551187654321" });
    expect((await recordInbound(msg({ phone: "5511987654321", text: "oi" }))).result).toBe("recorded");
  });

  it("não guarda mensagens de quem não é cliente", async () => {
    await createTestCustomer({ phone: "5511987654321" });
    expect((await recordInbound(msg({ phone: "5521912345678", text: "oi" }))).result).toBe("unknown_sender");
    expect(await prisma.inboundMessage.count()).toBe(0);
  });

  it("a mesma mensagem recebida duas vezes é registrada uma vez só", async () => {
    await createTestCustomer();
    const m = msg({ phone: "5511987654321", text: "parar" });
    expect((await recordInbound(m)).result).toBe("recorded");
    expect((await recordInbound(m)).result).toBe("duplicate");
    expect(await prisma.inboundMessage.count()).toBe(1);
  });

  it("pedido para parar só avisa: não descadastra nem cancela nada sozinho", async () => {
    const c = await createTestCustomer();
    await prisma.charge.create({ data: { customerId: c.id, description: "x", message: "m", scheduledAt: new Date(Date.now() + 3_600_000) } });
    await recordInbound(msg({ phone: c.phone, text: "Não quero mais receber essas mensagens" }));
    expect(await countUnhandledInbound()).toEqual({ total: 1, optOut: 1 });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).optedOutAt).toBeNull();
    expect(await prisma.charge.count({ where: { status: "PENDING" } })).toBe(1);
  });
});

describe("ações do painel", () => {
  it("descadastrar pelo painel cancela as pendentes e marca as respostas como vistas", async () => {
    const c = await createTestCustomer();
    await prisma.charge.create({ data: { customerId: c.id, description: "x", message: "m", scheduledAt: new Date(Date.now() + 3_600_000) } });
    await prisma.charge.create({ data: { customerId: c.id, description: "y", message: "m", scheduledAt: new Date(), status: "SENT" } });
    await recordInbound(msg({ phone: c.phone, text: "sair" }));
    expect(await optOutFromInbound(c.id)).toEqual({ cancelled: 1 });
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: c.id } })).optedOutAt).not.toBeNull();
    expect(await prisma.charge.count({ where: { status: "SENT" } })).toBe(1);
    expect(await countUnhandledInbound()).toEqual({ total: 0, optOut: 0 });
  });

  it("filtros e marcar todas como vistas", async () => {
    const c = await createTestCustomer();
    await recordInbound(msg({ phone: c.phone, text: "paguei" }));
    await recordInbound(msg({ phone: c.phone, text: "pare" }));
    await recordInbound(msg({ phone: c.phone, text: "bom dia" }));
    expect((await listInbound("pagamento")).total).toBe(1);
    expect((await listInbound("parar")).total).toBe(1);
    expect((await listInbound("nao-vistas")).total).toBe(3);
    expect(await markAllInboundHandled()).toBe(3);
    expect((await listInbound("nao-vistas")).total).toBe(0);
    expect((await listInbound("todas")).total).toBe(3);
  });
});

describe("retenção", () => {
  it("apaga respostas mais antigas que o prazo", async () => {
    const c = await createTestCustomer();
    await recordInbound(msg({ phone: c.phone, text: "antiga", receivedAt: new Date(Date.now() - 200 * 86_400_000) }));
    await recordInbound(msg({ phone: c.phone, text: "recente" }));
    await runRetention(180, logger);
    const left = await prisma.inboundMessage.findMany();
    expect(left.map((m) => m.text)).toEqual(["recente"]);
  });
});
