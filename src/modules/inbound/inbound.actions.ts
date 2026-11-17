"use server";

import { refresh } from "next/cache";
import { z } from "zod";
import type { ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { markAllInboundHandled, markInboundHandled, optOutFromInbound } from "./inbound.service";

const idSchema = z.uuid();

export async function markInboundHandledAction(id: string): Promise<ActionResult> {
  await requireUser();
  if (!idSchema.safeParse(id).success) return { ok: false, message: "Resposta inválida." };
  try {
    await markInboundHandled(id);
  } catch (err) {
    logger.error({ err }, "falha ao marcar resposta como vista");
    return { ok: false, message: "Não foi possível marcar como vista." };
  }
  refresh();
  return { ok: true };
}

export async function markAllInboundHandledAction(): Promise<ActionResult> {
  await requireUser();
  try {
    const count = await markAllInboundHandled();
    refresh();
    return { ok: true, message: count ? `${count} resposta(s) marcadas como vistas.` : "Nada para marcar." };
  } catch (err) {
    logger.error({ err }, "falha ao marcar respostas como vistas");
    return { ok: false, message: "Não foi possível marcar as respostas." };
  }
}

/** Só acontece quando o usuário confirma no painel: o pedido do cliente nunca descadastra sozinho. */
export async function optOutFromInboundAction(customerId: string): Promise<ActionResult> {
  await requireUser();
  if (!idSchema.safeParse(customerId).success) return { ok: false, message: "Cliente inválido." };
  try {
    const { cancelled } = await optOutFromInbound(customerId);
    refresh();
    return {
      ok: true,
      message: cancelled ? `Cliente descadastrado e ${cancelled} cobrança(s) agendada(s) cancelada(s).` : "Cliente descadastrado.",
    };
  } catch (err) {
    logger.error({ err }, "falha ao descadastrar cliente");
    return { ok: false, message: "Não foi possível descadastrar o cliente." };
  }
}
