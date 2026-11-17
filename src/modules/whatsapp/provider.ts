// Abstração do provedor de WhatsApp. Hoje: Baileys (não oficial). Amanhã: API oficial (Cloud API).
// O restante do sistema (gerenciador de conexão, fila de envio) só conhece esta interface.

/** Por que a conexão caiu, já traduzido para a decisão que importa (reconectar ou não). */
export type DisconnectKind =
  /** Usuário desconectou o aparelho no celular: a sessão não vale mais, precisa de QR novo. */
  | "logged_out"
  /** Pedido normal do WhatsApp (ex.: logo depois de ler o QR): reconectar na hora. */
  | "restart_required"
  /** A mesma sessão foi aberta em outro lugar. Não reconectar (evita briga entre instâncias). */
  | "connection_replaced"
  /** WhatsApp recusou a conta (bloqueio/restrição). Não reconectar. */
  | "forbidden"
  /** QR Code expirou sem ser lido. */
  | "qr_timeout"
  /** Nós mesmos fechamos a conexão (desligamento, reinício). */
  | "manual"
  /** Queda de rede, timeout, instabilidade: reconectar com espera crescente. */
  | "transient";

export type DisconnectInfo = { kind: DisconnectKind; code?: number; message?: string };

/** Mensagem recebida de uma pessoa (conversa individual), já extraída do formato do provedor. */
export type IncomingMessage = {
  /** Telefone do remetente, só dígitos com DDI. */
  phone: string;
  providerMessageId: string;
  kind: "TEXT" | "AUDIO" | "IMAGE" | "DOCUMENT" | "VIDEO" | "STICKER" | "OTHER";
  text: string | null;
  receivedAt: Date;
};

export type ProviderEvents = {
  qr: (qr: string) => void;
  open: (info: { phoneNumber: string | null }) => void;
  close: (info: DisconnectInfo) => void;
  message: (msg: IncomingMessage) => void;
};

export type SendResult = { providerMessageId: string | null };

/**
 * Erro lançado ANTES de qualquer coisa ir para a rede (ex.: não conectado).
 * É o único caso em que tentar de novo é seguro: com certeza nada foi enviado.
 */
/**
 * Erro que não se resolve tentando de novo (ex.: a chave de criptografia não abre a sessão salva).
 * O gerenciador de conexão para de reconectar e mostra a mensagem no painel.
 */
export class ProviderFatalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderFatalError";
  }
}

export class ProviderNotConnectedError extends Error {
  constructor(message = "WhatsApp não está conectado") {
    super(message);
    this.name = "ProviderNotConnectedError";
  }
}

export interface WhatsAppProvider {
  /** Abre a conexão usando a sessão salva (ou inicia o fluxo de QR se não houver). */
  start(): Promise<void>;
  /** Fecha a conexão mantendo a sessão salva. */
  stop(): Promise<void>;
  /** Desvincula o aparelho e apaga a sessão salva. */
  logout(): Promise<void>;
  /** Apaga a sessão salva sem falar com o WhatsApp (sessão já inválida). */
  clearSession(): Promise<void>;
  hasSession(): Promise<boolean>;
  isConnected(): boolean;
  /** Telefone (só dígitos) -> destinatário no formato do provedor, ou null se não tem WhatsApp. */
  resolveRecipient(phone: string): Promise<string | null>;
  sendText(recipient: string, text: string): Promise<SendResult>;
  on<E extends keyof ProviderEvents>(event: E, handler: ProviderEvents[E]): void;
}
