import { EventEmitter } from "node:events";
import type { DisconnectInfo, ProviderEvents, SendResult, WhatsAppProvider } from "./provider";

// Provedor falso para testes automatizados: não conecta em nada, mas se comporta como o real.
// Os testes controlam o que acontece (QR, conexão, queda, falha de envio).

export class MockWhatsAppProvider implements WhatsAppProvider {
  private emitter = new EventEmitter();
  private connected = false;
  private session = false;
  readonly sent: { recipient: string; text: string; id: string }[] = [];
  startCalls = 0;
  stopCalls = 0;
  logoutCalls = 0;
  /** Números (dígitos) que "não têm WhatsApp". */
  notOnWhatsApp = new Set<string>();
  /** Próximo envio falha com este erro (uma vez). */
  failNextSend: Error | null = null;
  /** Próximo envio nunca responde (simula timeout). */
  hangNextSend = false;
  /** O que start() faz: emitir QR (sem sessão) ou abrir direto (com sessão). */
  autoOpenOnStart = true;

  constructor(opts: { hasSession?: boolean } = {}) {
    this.session = !!opts.hasSession;
  }

  on<E extends keyof ProviderEvents>(event: E, handler: ProviderEvents[E]) {
    this.emitter.on(event, handler as (...args: unknown[]) => void);
  }

  async start() {
    this.startCalls++;
    if (!this.autoOpenOnStart) return;
    if (this.session) this.simulateOpen();
    else this.simulateQr("QR-FAKE-" + this.startCalls);
  }
  async stop() {
    this.stopCalls++;
    if (this.connected) this.simulateClose({ kind: "manual" });
  }
  async logout() {
    this.logoutCalls++;
    this.session = false;
    if (this.connected) this.simulateClose({ kind: "manual" });
  }
  async clearSession() {
    this.session = false;
  }
  async hasSession() {
    return this.session;
  }
  isConnected() {
    return this.connected;
  }
  async resolveRecipient(phone: string) {
    return this.notOnWhatsApp.has(phone) ? null : `${phone}@s.whatsapp.net`;
  }
  async sendText(recipient: string, text: string): Promise<SendResult> {
    if (!this.connected) throw new Error("not connected");
    if (this.hangNextSend) {
      this.hangNextSend = false;
      return new Promise<SendResult>(() => {});
    }
    if (this.failNextSend) {
      const err = this.failNextSend;
      this.failNextSend = null;
      throw err;
    }
    const id = `MSG-${this.sent.length + 1}`;
    this.sent.push({ recipient, text, id });
    return { providerMessageId: id };
  }

  // --- controles dos testes ---
  simulateQr(qr: string) {
    this.emitter.emit("qr", qr);
  }
  /** Simula a leitura do QR / abertura com sessão. */
  simulateOpen(phoneNumber = "5511999990000") {
    this.session = true;
    this.connected = true;
    this.emitter.emit("open", { phoneNumber });
  }
  simulateClose(info: DisconnectInfo) {
    this.connected = false;
    if (info.kind === "logged_out") this.session = false;
    this.emitter.emit("close", info);
  }
}
