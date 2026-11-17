import type { Logger } from "pino";
import type { ConnectionStore } from "@/modules/whatsapp/connection.repository";
import { ProviderFatalError, type DisconnectInfo, type WhatsAppProvider } from "@/modules/whatsapp/provider";
import { DISCONNECT_MESSAGES } from "./events";

// Gerencia o ciclo de vida da conexão: conectar, QR, reconexão com backoff, logout.
// Não conhece Baileys: funciona com qualquer WhatsAppProvider (o mock nos testes).

export type ReconnectOptions = {
  /** Tentativas seguidas antes de desistir e marcar ERROR. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
};

export const DEFAULT_RECONNECT: ReconnectOptions = { maxAttempts: 10, baseDelayMs: 2_000, maxDelayMs: 5 * 60_000 };

/** Espera da tentativa N: exponencial com teto e "jitter" (aleatoriedade) para não sincronizar tentativas. */
export function backoffDelay(attempt: number, opts: ReconnectOptions, random: () => number = Math.random): number {
  const exp = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** Math.max(0, attempt - 1));
  // Jitter "igual": metade fixa + metade aleatória.
  return Math.round(exp / 2 + random() * (exp / 2));
}

type Phase = "idle" | "connecting" | "qr" | "open" | "waiting_retry" | "stopped";

export class ConnectionManager {
  private phase: Phase = "idle";
  private attempts = 0;
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly provider: WhatsAppProvider,
    private readonly store: ConnectionStore,
    private readonly logger: Logger,
    private readonly opts: ReconnectOptions = DEFAULT_RECONNECT,
    private readonly random: () => number = Math.random,
  ) {
    provider.on("qr", (qr) => void this.onQr(qr));
    provider.on("open", (info) => void this.onOpen(info.phoneNumber));
    provider.on("close", (info) => void this.onClose(info));
  }

  get currentPhase(): Phase {
    return this.phase;
  }

  isConnected(): boolean {
    return this.phase === "open" && this.provider.isConnected();
  }

  /** Na inicialização do worker: reconecta sozinho se já houver sessão salva. */
  async init() {
    if (await this.provider.hasSession()) {
      this.logger.info("sessão do WhatsApp encontrada; reconectando");
      await this.connect();
    } else {
      await this.store.update({ status: "DISCONNECTED", qrCode: null, qrUpdatedAt: null });
      this.logger.info("nenhuma sessão do WhatsApp salva; aguardando comando de conexão");
    }
  }

  async connect() {
    if (this.phase === "open" || this.phase === "connecting" || this.phase === "qr") return;
    this.clearRetry();
    this.phase = "connecting";
    await this.store.update({ status: this.attempts > 0 ? "RECONNECTING" : "CONNECTING" });
    try {
      await this.provider.start();
    } catch (err) {
      this.logger.error({ err }, "falha ao iniciar conexão com o WhatsApp");
      if (err instanceof ProviderFatalError) {
        // Tentar de novo não resolve: para e explica no painel.
        this.phase = "idle";
        this.attempts = 0;
        await this.store.update({ status: "ERROR", qrCode: null, qrUpdatedAt: null, lastError: err.message });
        return;
      }
      await this.onClose({ kind: "transient", message: err instanceof Error ? err.message : String(err) });
    }
  }

  /** Desconectar pelo painel: desvincula o aparelho e apaga a sessão. */
  async disconnect() {
    this.clearRetry();
    this.phase = "stopped";
    this.attempts = 0;
    await this.provider.logout();
    await this.store.update({
      status: "DISCONNECTED",
      phoneNumber: null,
      qrCode: null,
      qrUpdatedAt: null,
      lastDisconnectedAt: new Date(),
      lastError: null,
    });
    this.phase = "idle";
    this.logger.info("WhatsApp desconectado pelo painel");
  }

  /** Reiniciar: fecha e abre de novo, mantendo a sessão. */
  async restart() {
    this.clearRetry();
    this.phase = "stopped";
    await this.provider.stop();
    this.phase = "idle";
    this.attempts = 0;
    await this.connect();
  }

  /** Desligamento do worker (SIGTERM): fecha sem apagar a sessão. */
  async shutdown() {
    this.clearRetry();
    this.phase = "stopped";
    await this.provider.stop().catch(() => {});
    await this.store
      .update({ status: "DISCONNECTED", qrCode: null, qrUpdatedAt: null, lastDisconnectedAt: new Date(), lastError: "Serviço de envio reiniciando." })
      .catch(() => {});
  }

  private async onQr(qr: string) {
    if (this.phase === "stopped") return;
    this.phase = "qr";
    await this.store.update({ status: "QR_CODE_REQUIRED", qrCode: qr, qrUpdatedAt: new Date(), lastError: null });
    this.logger.info("QR Code gerado; aguardando leitura");
  }

  private async onOpen(phoneNumber: string | null) {
    this.phase = "open";
    this.attempts = 0;
    this.clearRetry();
    await this.store.update({
      status: "CONNECTED",
      phoneNumber,
      qrCode: null,
      qrUpdatedAt: null,
      lastConnectedAt: new Date(),
      lastError: null,
    });
    this.logger.info("WhatsApp conectado");
  }

  private async onClose(info: DisconnectInfo) {
    const wasStopped = this.phase === "stopped";
    this.logger.warn({ kind: info.kind, code: info.code }, "conexão com o WhatsApp encerrada");
    if (info.kind === "manual" || wasStopped) return; // fechamos de propósito

    const now = new Date();
    switch (info.kind) {
      case "restart_required":
        // Normal logo após ler o QR: reabre imediatamente, sem contar como falha.
        this.phase = "idle";
        await this.connect();
        return;

      case "logged_out":
        this.phase = "idle";
        this.attempts = 0;
        await this.provider.clearSession();
        await this.store.update({
          status: "DISCONNECTED",
          phoneNumber: null,
          qrCode: null,
          qrUpdatedAt: null,
          lastDisconnectedAt: now,
          lastError: DISCONNECT_MESSAGES.logged_out,
        });
        return;

      case "qr_timeout":
        this.phase = "idle";
        await this.store.update({ status: "DISCONNECTED", qrCode: null, qrUpdatedAt: null, lastError: DISCONNECT_MESSAGES.qr_timeout });
        return;

      case "connection_replaced":
      case "forbidden":
        this.phase = "idle";
        await this.store.update({
          status: "ERROR",
          qrCode: null,
          qrUpdatedAt: null,
          lastDisconnectedAt: now,
          lastError: DISCONNECT_MESSAGES[info.kind],
        });
        return;

      case "transient":
        await this.scheduleRetry(info, now);
        return;
    }
  }

  private async scheduleRetry(info: DisconnectInfo, now: Date) {
    this.attempts++;
    if (this.attempts > this.opts.maxAttempts) {
      this.phase = "idle";
      await this.store.update({
        status: "ERROR",
        lastDisconnectedAt: now,
        lastError: `Não foi possível reconectar depois de ${this.opts.maxAttempts} tentativas. Clique em Reconectar.`,
      });
      this.logger.error({ attempts: this.opts.maxAttempts }, "limite de reconexões atingido");
      return;
    }
    const delay = backoffDelay(this.attempts, this.opts, this.random);
    this.phase = "waiting_retry";
    await this.store.update({
      status: "RECONNECTING",
      lastDisconnectedAt: now,
      lastError: `${DISCONNECT_MESSAGES.transient} Tentativa ${this.attempts} de ${this.opts.maxAttempts}.`,
    });
    this.logger.info({ attempt: this.attempts, delayMs: delay, code: info.code }, "reconexão agendada");
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.phase = "idle";
      void this.connect();
    }, delay);
    this.retryTimer.unref?.();
  }

  private clearRetry() {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }
}
