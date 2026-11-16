import { hash, verify } from "@node-rs/argon2";

// Senhas com Argon2id (padrão da biblioteca), parâmetros recomendados pela OWASP.
const OPTIONS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export { PASSWORD_MIN_LENGTH } from "./password-policy";

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Hash usado quando o e-mail não existe, para o tempo de resposta não revelar quais e-mails existem.
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword("senha-inexistente-para-tempo-constante");
  return dummyHash;
}
