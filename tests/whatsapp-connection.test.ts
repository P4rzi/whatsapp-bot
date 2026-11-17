import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectionPatch, ConnectionStore } from "@/modules/whatsapp/connection.repository";
import { MockWhatsAppProvider } from "@/modules/whatsapp/mock-provider";
import { ProviderFatalError } from "@/modules/whatsapp/provider";
import { backoffDelay, ConnectionManager, type ReconnectOptions } from "@/worker/whatsapp/connection";
import { classifyDisconnect, WA_CODES } from "@/worker/whatsapp/events";

const logger = pino({ level: "silent" });
const opts: ReconnectOptions = { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 8000 };

class MemoryStore implements ConnectionStore {
  state: ConnectionPatch = {};
  history: ConnectionPatch[] = [];
  async update(patch: ConnectionPatch) {
    this.state = { ...this.state, ...patch };
    this.history.push(patch);
  }
}

/** Deixa as promessas pendentes (handlers async dos eventos) terminarem. */
const flush = () => new Promise((r) => setImmediate(r));

function setup(hasSession = false) {
  const provider = new MockWhatsAppProvider({ hasSession });
  const store = new MemoryStore();
  const manager = new ConnectionManager(provider, store, logger, opts, () => 0.5);
  return { provider, store, manager };
}

describe("classificação das desconexões", () => {
  it("diferencia logout, reinício, substituição, bloqueio, QR expirado e queda temporária", () => {
    expect(classifyDisconnect(WA_CODES.loggedOut, true)).toBe("logged_out");
    expect(classifyDisconnect(WA_CODES.restartRequired, false)).toBe("restart_required");
    expect(classifyDisconnect(WA_CODES.connectionReplaced, true)).toBe("connection_replaced");
    expect(classifyDisconnect(WA_CODES.forbidden, true)).toBe("forbidden");
    expect(classifyDisconnect(WA_CODES.connectionLost, false)).toBe("qr_timeout");
    expect(classifyDisconnect(WA_CODES.connectionLost, true)).toBe("transient");
    expect(classifyDisconnect(WA_CODES.unavailableService, true)).toBe("transient");
    expect(classifyDisconnect(undefined, true)).toBe("transient");
  });
});

describe("backoff exponencial com jitter", () => {
  it("cresce a cada tentativa e respeita o teto", () => {
    const mid = () => 0.5;
    expect(backoffDelay(1, opts, mid)).toBe(750); // 1000 -> 500..1000
    expect(backoffDelay(2, opts, mid)).toBe(1500);
    expect(backoffDelay(3, opts, mid)).toBe(3000);
    expect(backoffDelay(10, opts, mid)).toBe(6000); // teto 8000 -> 4000..8000
  });
  it("jitter fica entre metade e o valor cheio", () => {
    expect(backoffDelay(2, opts, () => 0)).toBe(1000);
    expect(backoffDelay(2, opts, () => 1)).toBe(2000);
  });
});

describe("gerenciador de conexão", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
  afterEach(() => vi.useRealTimers());

  it("sem sessão: espera o comando; ao conectar mostra o QR e, lido, fica CONNECTED sem QR", async () => {
    const { provider, store, manager } = setup(false);
    await manager.init();
    expect(provider.startCalls).toBe(0);
    expect(store.state.status).toBe("DISCONNECTED");

    await manager.connect();
    await flush();
    expect(store.state.status).toBe("QR_CODE_REQUIRED");
    expect(store.state.qrCode).toBe("QR-FAKE-1");

    provider.simulateOpen("5511988887777");
    await flush();
    expect(store.state.status).toBe("CONNECTED");
    expect(store.state.phoneNumber).toBe("5511988887777");
    expect(store.state.qrCode).toBeNull();
    expect(store.state.lastConnectedAt).toBeInstanceOf(Date);
  });

  it("com sessão salva: reconecta sozinho ao iniciar (recuperação após reinício)", async () => {
    const { provider, store, manager } = setup(true);
    await manager.init();
    await flush();
    expect(provider.startCalls).toBe(1);
    expect(store.state.status).toBe("CONNECTED");
    expect(store.history.some((p) => p.qrCode)).toBe(false); // nunca pediu QR
  });

  it("restartRequired (logo após ler o QR) reabre na hora, sem contar falha", async () => {
    const { provider, store, manager } = setup(false);
    await manager.connect();
    await flush();
    provider.simulateClose({ kind: "restart_required", code: WA_CODES.restartRequired });
    await flush();
    expect(provider.startCalls).toBe(2);
    expect(store.state.status).not.toBe("RECONNECTING");
  });

  it("queda temporária: reconecta com espera crescente e para no limite com ERROR", async () => {
    const { provider, store, manager } = setup(true);
    provider.autoOpenOnStart = false; // as tentativas não conseguem abrir
    await manager.init();
    provider.simulateClose({ kind: "transient", code: 503 });
    await flush();
    expect(store.state.status).toBe("RECONNECTING");
    expect(store.state.lastError).toContain("Tentativa 1 de 3");

    await vi.advanceTimersByTimeAsync(749);
    expect(provider.startCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(provider.startCalls).toBe(2);

    provider.simulateClose({ kind: "transient" });
    await flush();
    await vi.advanceTimersByTimeAsync(1500);
    expect(provider.startCalls).toBe(3);

    provider.simulateClose({ kind: "transient" });
    await flush();
    await vi.advanceTimersByTimeAsync(3000);
    expect(provider.startCalls).toBe(4);

    provider.simulateClose({ kind: "transient" });
    await flush();
    expect(store.state.status).toBe("ERROR");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(provider.startCalls).toBe(4); // não tenta mais sozinho
  });

  it("reconexão bem-sucedida zera o contador de tentativas", async () => {
    const { provider, store, manager } = setup(true);
    await manager.init();
    await flush();
    provider.simulateClose({ kind: "transient" });
    await flush();
    await vi.advanceTimersByTimeAsync(750);
    await flush();
    expect(store.state.status).toBe("CONNECTED");
    provider.simulateClose({ kind: "transient" });
    await flush();
    expect(store.state.lastError).toContain("Tentativa 1 de 3");
  });

  it("logout feito no celular: apaga a sessão e pede novo QR, sem reconectar sozinho", async () => {
    const { provider, store, manager } = setup(true);
    await manager.init();
    await flush();
    provider.simulateClose({ kind: "logged_out", code: WA_CODES.loggedOut });
    await flush();
    expect(store.state.status).toBe("DISCONNECTED");
    expect(store.state.phoneNumber).toBeNull();
    expect(store.state.lastError).toMatch(/novo QR Code/);
    expect(await provider.hasSession()).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(provider.startCalls).toBe(1);
  });

  it("sessão aberta em outro lugar ou conta bloqueada: ERROR, sem reconectar", async () => {
    for (const kind of ["connection_replaced", "forbidden"] as const) {
      const { provider, store, manager } = setup(true);
      await manager.init();
      await flush();
      provider.simulateClose({ kind });
      await flush();
      expect(store.state.status).toBe("ERROR");
      await vi.advanceTimersByTimeAsync(60_000);
      expect(provider.startCalls).toBe(1);
    }
  });

  it("QR expirado sem leitura: volta para DISCONNECTED com aviso", async () => {
    const { provider, store, manager } = setup(false);
    await manager.connect();
    await flush();
    provider.simulateClose({ kind: "qr_timeout", code: 408 });
    await flush();
    expect(store.state.status).toBe("DISCONNECTED");
    expect(store.state.qrCode).toBeNull();
    expect(store.state.lastError).toMatch(/expirou/);
  });

  it("desconectar pelo painel faz logout e não reconecta", async () => {
    const { provider, store, manager } = setup(true);
    await manager.init();
    await flush();
    await manager.disconnect();
    await flush();
    expect(provider.logoutCalls).toBe(1);
    expect(store.state.status).toBe("DISCONNECTED");
    expect(await provider.hasSession()).toBe(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(provider.startCalls).toBe(1);
  });

  it("conectar duas vezes seguidas não abre duas conexões", async () => {
    const { provider, manager } = setup(false);
    await Promise.all([manager.connect(), manager.connect()]);
    expect(provider.startCalls).toBe(1);
  });

  it("desligamento do worker fecha sem apagar a sessão", async () => {
    const { provider, store, manager } = setup(true);
    await manager.init();
    await flush();
    await manager.shutdown();
    await flush();
    expect(await provider.hasSession()).toBe(true);
    expect(store.state.status).toBe("DISCONNECTED");
    expect(provider.startCalls).toBe(1);
  });
});

describe("erros que não se resolvem tentando de novo", () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] }));
  afterEach(() => vi.useRealTimers());

  it("chave de criptografia errada: ERROR com explicação, sem reconectar sozinho", async () => {
    const { provider, store, manager } = setup(true);
    provider.failNextStart = new ProviderFatalError("A sessão salva do WhatsApp não abre com a ENCRYPTION_KEY atual.");
    await manager.init();
    expect(store.state.status).toBe("ERROR");
    expect(store.state.lastError).toMatch(/ENCRYPTION_KEY/);
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(provider.startCalls).toBe(1);
  });

  it("falha comum ao iniciar: tenta de novo com espera", async () => {
    const { provider, store, manager } = setup(true);
    provider.failNextStart = new Error("rede indisponível");
    await manager.init();
    expect(store.state.status).toBe("RECONNECTING");
    await vi.advanceTimersByTimeAsync(1000);
    expect(provider.startCalls).toBe(2);
  });
});
