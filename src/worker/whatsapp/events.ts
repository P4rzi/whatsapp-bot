import type { DisconnectKind } from "@/modules/whatsapp/provider";

// Códigos de desconexão do Baileys (DisconnectReason), repetidos aqui para a regra ser testável
// sem carregar a biblioteca.
export const WA_CODES = {
  connectionClosed: 428,
  connectionLost: 408, // também "timedOut"
  connectionReplaced: 440,
  loggedOut: 401,
  badSession: 500,
  restartRequired: 515,
  multideviceMismatch: 411,
  forbidden: 403,
  unavailableService: 503,
} as const;

/**
 * Traduz o código de desconexão na decisão de reconexão.
 * @param registered se já existia sessão autenticada (fora do fluxo de QR)
 */
export function classifyDisconnect(code: number | undefined, registered: boolean): DisconnectKind {
  switch (code) {
    case WA_CODES.loggedOut:
    case WA_CODES.multideviceMismatch:
      return "logged_out";
    case WA_CODES.restartRequired:
      return "restart_required";
    case WA_CODES.connectionReplaced:
      return "connection_replaced";
    case WA_CODES.forbidden:
      return "forbidden";
    case WA_CODES.connectionLost:
      // No fluxo de QR, o timeout significa que ninguém leu o código a tempo.
      return registered ? "transient" : "qr_timeout";
    default:
      return registered ? "transient" : "qr_timeout";
  }
}

export const DISCONNECT_MESSAGES: Record<DisconnectKind, string> = {
  logged_out: "O aparelho foi desconectado pelo celular. Clique em Conectar para gerar um novo QR Code.",
  restart_required: "Reiniciando a conexão.",
  connection_replaced: "Esta sessão foi aberta em outro lugar. Verifique se há só um serviço de envio rodando e clique em Reconectar.",
  forbidden: "O WhatsApp recusou a conexão (a conta pode estar bloqueada ou restrita).",
  qr_timeout: "O QR Code expirou sem ser lido. Clique em Conectar para gerar outro.",
  manual: "Conexão encerrada.",
  transient: "Conexão perdida. Tentando reconectar.",
};
