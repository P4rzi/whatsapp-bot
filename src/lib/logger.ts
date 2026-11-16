import pino from "pino";

// Logger estruturado (JSON em produção). Campos sensíveis são removidos automaticamente.
// Telefones devem ser mascarados com maskPhone() antes de irem para o log.

export function createLogger(service: string) {
  return pino({
    level: process.env.LOG_LEVEL ?? "info",
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT_PATHS, censor: "[removido]" },
  });
}

const REDACT_PATHS = [
  "password",
  "passwordHash",
  "*.password",
  "*.passwordHash",
  "token",
  "*.token",
  "qrCode",
  "*.qrCode",
  "creds",
  "*.creds",
  "keys",
  "*.keys",
  "authorization",
  "*.authorization",
  "cookie",
  "*.cookie",
];

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "web" },
  timestamp: pino.stdTimeFunctions.isoTime,
  redact: { paths: REDACT_PATHS, censor: "[removido]" },
});

/** 5511987654321 -> 55119****4321 */
export function maskPhone(phone: string | null | undefined): string {
  if (!phone) return "";
  const digits = phone.replace(/\D/g, "");
  if (digits.length <= 8) return "****";
  return `${digits.slice(0, 5)}****${digits.slice(-4)}`;
}
