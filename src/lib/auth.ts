import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import {
  createSessionToken,
  passwordFingerprint,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  verifySessionToken,
} from "@/lib/auth/session";

// Camada de acesso (DAL): toda página e ação protegida passa por aqui.
// O Proxy faz só uma checagem rápida; esta é a checagem de verdade (usuário existe, senha não mudou).

export type CurrentUser = { id: string; name: string; email: string };

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);
  if (!session) return null;

  const user = await prisma.user.findUnique({
    where: { id: session.sub },
    select: { id: true, name: true, email: true, passwordHash: true },
  });
  if (!user || passwordFingerprint(user.passwordHash) !== session.pv) {
    logger.info({ event: "session_rejected", reason: user ? "password_changed" : "user_not_found" }, "sessão recusada");
    return null;
  }
  return { id: user.id, name: user.name, email: user.email };
}

/** Exige usuário logado; caso contrário, manda para o login. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

export async function startSession(user: { id: string; passwordHash: string }) {
  const token = await createSessionToken({ sub: user.id, pv: passwordFingerprint(user.passwordHash) });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function endSession() {
  (await cookies()).delete(SESSION_COOKIE);
}
