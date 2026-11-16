import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSessionToken, passwordFingerprint, verifySessionToken } from "@/lib/auth/session";
import { createRateLimiter } from "@/lib/rate-limit";
import { loginSchema } from "@/modules/auth/auth.schema";

describe("senha (Argon2id)", () => {
  it("gera hash argon2id e confere a senha", async () => {
    const hash = await hashPassword("uma senha forte 123");
    expect(hash.startsWith("$argon2id$")).toBe(true);
    expect(await verifyPassword(hash, "uma senha forte 123")).toBe(true);
    expect(await verifyPassword(hash, "senha errada")).toBe(false);
  });
  it("não quebra com hash inválido", async () => {
    expect(await verifyPassword("lixo", "x")).toBe(false);
  });
});

describe("token de sessão", () => {
  it("assina e valida", async () => {
    const token = await createSessionToken({ sub: "user-1", pv: "abc" });
    expect(await verifySessionToken(token)).toEqual({ sub: "user-1", pv: "abc" });
  });
  it("rejeita token adulterado ou ausente", async () => {
    const token = await createSessionToken({ sub: "user-1", pv: "abc" });
    const [h, p, s] = token.split(".");
    const forged = Buffer.from(JSON.stringify({ sub: "admin", pv: "abc", exp: 9999999999 })).toString("base64url");
    expect(await verifySessionToken(`${h}.${forged}.${s}`)).toBeNull();
    expect(await verifySessionToken(`${h}.${p}.x${s}`)).toBeNull();
    expect(await verifySessionToken(undefined)).toBeNull();
  });
  it("impressão digital muda quando a senha muda (invalida sessões antigas)", async () => {
    const a = passwordFingerprint(await hashPassword("senha antiga 123"));
    const b = passwordFingerprint(await hashPassword("senha nova 456"));
    expect(a).not.toBe(b);
  });
});

describe("limite de tentativas de login", () => {
  it("bloqueia depois do limite e libera após a janela", () => {
    const rl = createRateLimiter({ limit: 3, windowMs: 1000 });
    const t0 = 1_000_000;
    for (let i = 0; i < 3; i++) {
      expect(rl.check("k", t0)).toBe(0);
      rl.hit("k", t0);
    }
    expect(rl.check("k", t0)).toBeGreaterThan(0);
    expect(rl.check("k", t0 + 1001)).toBe(0);
  });
});

describe("validação do login", () => {
  it("normaliza e-mail e exige senha", () => {
    expect(loginSchema.parse({ email: " ADMIN@Exemplo.com ", password: "x" }).email).toBe("admin@exemplo.com");
    expect(loginSchema.safeParse({ email: "naoemail", password: "x" }).success).toBe(false);
    expect(loginSchema.safeParse({ email: "a@b.com", password: "" }).success).toBe(false);
  });
});
