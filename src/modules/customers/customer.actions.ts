"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { toFieldErrors, type ActionResult } from "@/lib/action-result";
import { requireUser } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { customerFormSchema, type CustomerFormValues } from "./customer.schema";
import { createCustomer, CustomerError, deleteCustomer, DuplicatePhoneError, updateCustomer } from "./customer.service";

const idSchema = z.uuid();

function fail(err: unknown, fallback: string): ActionResult {
  if (err instanceof DuplicatePhoneError) {
    return { ok: false, message: err.message, fieldErrors: { phone: err.message } };
  }
  if (err instanceof CustomerError) return { ok: false, message: err.message };
  logger.error({ err }, fallback);
  return { ok: false, message: fallback };
}

export async function createCustomerAction(values: CustomerFormValues): Promise<ActionResult> {
  await requireUser();
  const parsed = customerFormSchema.safeParse(values);
  if (!parsed.success) {
    return { ok: false, message: "Verifique os campos.", fieldErrors: toFieldErrors(parsed.error.issues) };
  }
  let id: string;
  try {
    id = (await createCustomer(parsed.data)).id;
  } catch (err) {
    return fail(err, "Não foi possível salvar o cliente.");
  }
  redirect(`/clientes/${id}`);
}

export async function updateCustomerAction(id: string, values: CustomerFormValues): Promise<ActionResult> {
  await requireUser();
  if (!idSchema.safeParse(id).success) return { ok: false, message: "Cliente inválido." };
  const parsed = customerFormSchema.safeParse(values);
  if (!parsed.success) {
    return { ok: false, message: "Verifique os campos.", fieldErrors: toFieldErrors(parsed.error.issues) };
  }
  try {
    await updateCustomer(id, parsed.data);
  } catch (err) {
    return fail(err, "Não foi possível salvar o cliente.");
  }
  refresh();
  return { ok: true, message: "Cliente atualizado." };
}

export async function deleteCustomerAction(id: string): Promise<ActionResult> {
  await requireUser();
  if (!idSchema.safeParse(id).success) return { ok: false, message: "Cliente inválido." };
  try {
    await deleteCustomer(id);
  } catch (err) {
    return fail(err, "Não foi possível excluir o cliente.");
  }
  redirect("/clientes");
}
