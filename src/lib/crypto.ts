import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Criptografia simétrica AES-256-GCM para dados sensíveis em repouso (sessão do WhatsApp).
// Formato: versão (1 byte) | IV (12 bytes) | tag (16 bytes) | dados cifrados.

const VERSION = 1;
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

export function parseKey(hex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("ENCRYPTION_KEY deve ter 64 caracteres hexadecimais");
  return Buffer.from(hex, "hex");
}

export function encrypt(plain: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain), cipher.final()]);
  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), data]);
}

/** Lança erro se a chave estiver errada ou os dados tiverem sido alterados. */
export function decrypt(payload: Buffer, key: Buffer): Buffer {
  if (payload.length < 1 + IV_LENGTH + TAG_LENGTH || payload[0] !== VERSION) {
    throw new Error("Formato de dado criptografado inválido");
  }
  const iv = payload.subarray(1, 1 + IV_LENGTH);
  const tag = payload.subarray(1 + IV_LENGTH, 1 + IV_LENGTH + TAG_LENGTH);
  const data = payload.subarray(1 + IV_LENGTH + TAG_LENGTH);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]);
}
