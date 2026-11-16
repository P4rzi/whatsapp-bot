"use server";

import { refresh } from "next/cache";
import { toFieldErrors, type ActionResult } from "@/lib/action-result";
import { requireUser, startSession } from "@/lib/auth";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rate-limit";
import {
  messageTemplateSchema,
  passwordChangeSchema,
  type MessageTemplateValues,
  type PasswordChangeValues,
} from "./settings.schema";
import { saveDefaultMessageTemplate } from "./settings.service";

// Senha atual errada repetidas vezes também é limitada (mesmo estando logado).
const passwordLimiter = createRateLimiter({ limit: 5, windowMs: 15 * 60_000 });

export async function changePasswordAction(values: PasswordChangeValues): Promise<ActionResult> {
  const current = await requireUser();
  const parsed = passwordChangeSchema.safeParse(values);
  if (!parsed.success) {
    return { ok: false, message: "Verifique os campos.", fieldErrors: toFieldErrors(parsed.error.issues) };
  }
  const wait = passwordLimiter.check(current.id);
  if (wait > 0) return { ok: false, message: `Muitas tentativas. Tente novamente em ${Math.ceil(wait / 60)} min.` };

  const user = await prisma.user.findUniqueOrThrow({ where: { id: current.id } });
  if (!(await verifyPassword(user.passwordHash, parsed.data.currentPassword))) {
    passwordLimiter.hit(current.id);
    return { ok: false, message: "Senha atual incorreta.", fieldErrors: { currentPassword: "Senha atual incorreta" } };
  }
  passwordLimiter.reset(current.id);

  const passwordHash = await hashPassword(parsed.data.newPassword);
  const updated = await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  // A troca invalida todas as sessões antigas (outros navegadores). Esta continua logada com um cookie novo.
  await startSession(updated);
  logger.info({ event: "password_changed", userId: user.id }, "senha alterada");
  return { ok: true, message: "Senha alterada. Outras sessões abertas foram encerradas." };
}

export async function saveMessageTemplateAction(values: MessageTemplateValues): Promise<ActionResult> {
  await requireUser();
  const parsed = messageTemplateSchema.safeParse(values);
  if (!parsed.success) {
    return { ok: false, message: "Verifique os campos.", fieldErrors: toFieldErrors(parsed.error.issues) };
  }
  await saveDefaultMessageTemplate(parsed.data.defaultMessageTemplate);
  refresh();
  return { ok: true, message: "Mensagem padrão salva. Ela será usada nas próximas cobranças." };
}
