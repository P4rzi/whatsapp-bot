"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { endSession, startSession } from "@/lib/auth";
import { getDummyHash, verifyPassword } from "@/lib/auth/password";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { createRateLimiter } from "@/lib/rate-limit";
import type { ActionResult } from "@/lib/action-result";
import { loginSchema, type LoginInput } from "./auth.schema";

// Limites de senha errada a cada 15 minutos:
// - por e-mail (independe do IP): o cabeçalho de IP pode ser forjado pelo cliente, então o limite
//   que protege a conta não pode depender dele;
// - por IP: barra quem testa muitos e-mails diferentes a partir do mesmo endereço.
const byAccount = createRateLimiter({ limit: 10, windowMs: 15 * 60_000 });
const byIp = createRateLimiter({ limit: 30, windowMs: 15 * 60_000 });

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || "local";
}

export async function loginAction(input: LoginInput): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "E-mail ou senha inválidos." };
  const { email, password } = parsed.data;

  const ip = await clientIp();
  const accountKey = `email:${email}`;
  const wait = Math.max(byAccount.check(accountKey), byIp.check(ip));
  if (wait > 0) {
    return { ok: false, message: `Muitas tentativas. Tente novamente em ${Math.ceil(wait / 60)} min.` };
  }

  const user = await prisma.user.findUnique({ where: { email } });
  const valid = user
    ? await verifyPassword(user.passwordHash, password)
    : (await verifyPassword(await getDummyHash(), password), false);

  if (!user || !valid) {
    byAccount.hit(accountKey);
    byIp.hit(ip);
    logger.warn({ event: "login_failed" }, "tentativa de login inválida");
    return { ok: false, message: "E-mail ou senha inválidos." };
  }

  byAccount.reset(accountKey);
  await startSession(user);
  logger.info({ event: "login", userId: user.id }, "login realizado");
  redirect("/dashboard");
}

export async function logoutAction() {
  await endSession();
  redirect("/login");
}
