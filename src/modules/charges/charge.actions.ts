"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { toFieldErrors, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { chargeFormSchema, type ChargeFormValues } from "./charge.schema";
import { cancelCharge, ChargeError, createCharge, retryCharge, updateCharge } from "./charge.service";

function fail(err: unknown, fallback: string): ActionResult {
  if (err instanceof ChargeError) return { ok: false, message: err.message };
  logger.error({ err }, fallback);
  return { ok: false, message: fallback };
}

export async function createChargeAction(values: ChargeFormValues): Promise<ActionResult> {
  await requireUser();
  const parsed = chargeFormSchema.safeParse(values);
  if (!parsed.success) {
    return { ok: false, message: "Verifique os campos.", fieldErrors: toFieldErrors(parsed.error.issues) };
  }
  try {
    const charge = await createCharge(parsed.data);
    logger.info({ event: "charge_created", chargeId: charge.id, scheduledAt: charge.scheduledAt }, "cobrança agendada");
  } catch (err) {
    return fail(err, "Não foi possível agendar a cobrança.");
  }
  redirect("/cobrancas?status=PENDING");
}

export async function updateChargeAction(id: string, values: ChargeFormValues): Promise<ActionResult> {
  await requireUser();
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "Cobrança inválida." };
  const parsed = chargeFormSchema.safeParse(values);
  if (!parsed.success) {
    return { ok: false, message: "Verifique os campos.", fieldErrors: toFieldErrors(parsed.error.issues) };
  }
  try {
    await updateCharge(id, parsed.data);
    logger.info({ event: "charge_updated", chargeId: id }, "cobrança editada");
  } catch (err) {
    return fail(err, "Não foi possível salvar a cobrança.");
  }
  redirect("/cobrancas?status=PENDING");
}

export async function retryChargeAction(id: string): Promise<ActionResult> {
  await requireUser();
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "Cobrança inválida." };
  try {
    await retryCharge(id);
    logger.info({ event: "charge_retry", chargeId: id }, "reenvio manual solicitado");
  } catch (err) {
    return fail(err, "Não foi possível reenviar a cobrança.");
  }
  refresh();
  return { ok: true, message: "Cobrança devolvida para a fila de envio." };
}

export async function cancelChargeAction(id: string): Promise<ActionResult> {
  await requireUser();
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "Cobrança inválida." };
  try {
    await cancelCharge(id);
    logger.info({ event: "charge_cancelled", chargeId: id }, "cobrança cancelada");
  } catch (err) {
    return fail(err, "Não foi possível cancelar a cobrança.");
  }
  refresh();
  return { ok: true, message: "Cobrança cancelada." };
}
