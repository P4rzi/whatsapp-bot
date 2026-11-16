import { createHash } from "node:crypto";
import { jwtVerify, SignJWT } from "jose";

// Token de sessão assinado (JWT HS256) guardado em cookie httpOnly.
// Usado tanto pelo Proxy (checagem rápida) quanto pela camada de acesso a dados (checagem completa).

export const SESSION_COOKIE = "session";
export const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 horas

export type SessionPayload = {
  /** id do usuário */
  sub: string;
  /** impressão digital do hash da senha: trocar a senha invalida as sessões antigas */
  pv: string;
};

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET ausente ou curta (mínimo 32 caracteres)");
  }
  return new TextEncoder().encode(secret);
}

export function passwordFingerprint(passwordHash: string): string {
  return createHash("sha256").update(passwordHash).digest("base64url").slice(0, 16);
}

export async function createSessionToken(payload: SessionPayload): Promise<string> {
  return new SignJWT({ pv: payload.pv })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifySessionToken(token: string | undefined): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret(), { algorithms: ["HS256"] });
    if (typeof payload.sub !== "string" || typeof payload.pv !== "string") return null;
    return { sub: payload.sub, pv: payload.pv };
  } catch {
    return null;
  }
}
