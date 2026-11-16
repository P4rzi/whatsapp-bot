"use server";

import type { ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { enqueueCommand } from "./command.repository";

type Kind = "connect" | "disconnect" | "restart";

const TYPES = {
  connect: "CONNECT_WHATSAPP",
  disconnect: "DISCONNECT_WHATSAPP",
  restart: "RESTART_WHATSAPP",
} as const;

const MESSAGES: Record<Kind, string> = {
  connect: "Pedido de conexão enviado. O QR Code aparece em alguns segundos.",
  disconnect: "Pedido de desconexão enviado.",
  restart: "Pedido de reconexão enviado.",
};

export async function whatsappCommandAction(kind: Kind): Promise<ActionResult> {
  const user = await requireUser();
  if (!(kind in TYPES)) return { ok: false, message: "Comando inválido." };
  try {
    await enqueueCommand(TYPES[kind]);
    logger.info({ event: "whatsapp_command", kind, userId: user.id }, "comando do WhatsApp registrado");
    return { ok: true, message: MESSAGES[kind] };
  } catch (err) {
    logger.error({ err }, "falha ao registrar comando do WhatsApp");
    return { ok: false, message: "Não foi possível enviar o pedido. Tente novamente." };
  }
}
