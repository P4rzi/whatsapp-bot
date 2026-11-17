import { EventEmitter } from "node:events";
import {
  Browsers,
  fetchLatestWaWebVersion,
  makeCacheableSignalKeyStore,
  makeWASocket,
  type WASocket,
} from "@whiskeysockets/baileys";
import type { Logger } from "pino";
import { ProviderNotConnectedError, type DisconnectInfo, type ProviderEvents, type SendResult, type WhatsAppProvider } from "@/modules/whatsapp/provider";
import { classifyDisconnect } from "./events";
import { hasRegisteredSession, openEncryptedAuthState, type EncryptedAuthState } from "./session";

// Implementação do WhatsAppProvider com Baileys (WhatsApp Web, não oficial).
// Não envia confirmações de leitura, não fica "online" e não baixa o histórico completo:
// o objetivo é apenas enviar as mensagens de cobrança.

type BoomLike = { output?: { statusCode?: number }; message?: string };

export class BaileysProvider implements WhatsAppProvider {
  private emitter = new EventEmitter();
  private sock: WASocket | null = null;
  private connected = false;
  private closingManually = false;
  /**
   * Um único armazenamento de sessão por processo. Reabrir a cada conexão criava uma corrida: logo
   * após ler o QR o WhatsApp pede reinício (515) enquanto as credenciais novas ainda estão sendo
   * gravadas, e a reabertura podia ler o arquivo antigo (pedindo QR de novo).
   */
  private auth: EncryptedAuthState | null = null;

  private async getAuth(): Promise<EncryptedAuthState> {
    this.auth ??= await openEncryptedAuthState(this.sessionPath, this.key);
    return this.auth;
  }

  /** Apaga a sessão no disco e na memória (próxima conexão começa do zero, com QR). */
  private async dropAuth() {
    const auth = await this.getAuth();
    await auth.clear();
    this.auth = null;
  }

  constructor(
    private readonly sessionPath: string,
    private readonly key: Buffer,
    private readonly logger: Logger,
  ) {}

  on<E extends keyof ProviderEvents>(event: E, handler: ProviderEvents[E]) {
    this.emitter.on(event, handler as (...args: unknown[]) => void);
  }

  async hasSession() {
    return hasRegisteredSession(this.sessionPath, this.key);
  }

  isConnected() {
    return this.connected;
  }

  async start() {
    if (this.sock) return;
    this.closingManually = false;
    const auth = await this.getAuth();
    await auth.flush(); // credenciais da conexão anterior gravadas antes de reconectar

    // Versão atual do WhatsApp Web; se a consulta falhar, usa a padrão da biblioteca.
    let version: [number, number, number] | undefined;
    try {
      const latest = await fetchLatestWaWebVersion();
      version = latest.version as [number, number, number];
    } catch (err) {
      this.logger.warn({ err }, "não foi possível obter a versão do WhatsApp Web; usando a padrão");
    }

    // Logs internos do Baileys só a partir de "warn" (são muito verbosos e podem conter dados).
    const baileysLogger = this.logger.child({ module: "baileys" }, { level: "warn" });

    const sock = makeWASocket({
      ...(version ? { version } : {}),
      auth: { creds: auth.state.creds, keys: makeCacheableSignalKeyStore(auth.state.keys, baileysLogger) },
      logger: baileysLogger,
      browser: Browsers.ubuntu("Cobrancas"),
      markOnlineOnConnect: false,
      // Sem histórico completo. A sincronização inicial padrão fica ligada: o Baileys v7 precisa dela
      // para obter os mapeamentos de identificadores (LID); desligá-la causa instabilidade na sessão.
      syncFullHistory: false,
      generateHighQualityLinkPreview: false,
      getMessage: async () => undefined,
    });
    this.sock = sock;

    sock.ev.on("creds.update", () => {
      auth.saveCreds().catch((err) => this.logger.error({ err }, "falha ao salvar credenciais do WhatsApp"));
    });

    sock.ev.on("connection.update", (update) => {
      if (update.qr) this.emitter.emit("qr", update.qr);

      if (update.connection === "open") {
        this.connected = true;
        const phone = sock.user?.id ? sock.user.id.split(":")[0].split("@")[0] : null;
        this.emitter.emit("open", { phoneNumber: phone });
      }

      if (update.connection === "close") {
        this.connected = false;
        this.sock = null;
        const error = update.lastDisconnect?.error as BoomLike | undefined;
        const code = error?.output?.statusCode;
        const info: DisconnectInfo = this.closingManually
          ? { kind: "manual", code }
          : { kind: classifyDisconnect(code, !!auth.state.creds.registered || !!auth.state.creds.me), code, message: error?.message };
        this.closingManually = false;
        if (info.kind === "logged_out") {
          this.dropAuth().catch((err) => this.logger.error({ err }, "falha ao apagar sessão após logout"));
        }
        this.emitter.emit("close", info);
      }
    });
  }

  async stop() {
    if (!this.sock) return;
    this.closingManually = true;
    await this.sock.end(undefined);
  }

  async logout() {
    if (this.sock) {
      this.closingManually = true;
      try {
        await this.sock.logout("Desconectado pelo painel");
      } catch (err) {
        // Se o socket já estava fechado, apaga a sessão local mesmo assim.
        this.logger.warn({ err }, "logout no WhatsApp falhou; apagando sessão local");
        await this.sock?.end(undefined).catch(() => {});
      }
    }
    await this.dropAuth();
  }

  async clearSession() {
    await this.dropAuth();
  }

  async resolveRecipient(phone: string): Promise<string | null> {
    if (!this.sock || !this.connected) throw new ProviderNotConnectedError();
    const [result] = (await this.sock.onWhatsApp(phone)) ?? [];
    return result?.exists ? result.jid : null;
  }

  async sendText(recipient: string, text: string): Promise<SendResult> {
    if (!this.sock || !this.connected) throw new ProviderNotConnectedError();
    const msg = await this.sock.sendMessage(recipient, { text });
    return { providerMessageId: msg?.key?.id ?? null };
  }
}

