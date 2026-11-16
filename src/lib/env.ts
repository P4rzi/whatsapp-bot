import { z } from "zod";

// Validação das variáveis de ambiente. Cada processo valida só o que usa,
// para que o web não precise das chaves do worker e vice-versa.

const base = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatória"),
  TIMEZONE: z.string().default("America/Sao_Paulo"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

const webSchema = base.extend({
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET precisa ter pelo menos 32 caracteres"),
});

const workerSchema = base.extend({
  WHATSAPP_SESSION_PATH: z.string().min(1).default("./data/whatsapp-session"),
  ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-fA-F]{64}$/, "ENCRYPTION_KEY deve ter 64 caracteres hexadecimais (32 bytes)"),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(1000).default(10000),
  MESSAGE_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  /// Intervalo mínimo entre dois envios consecutivos, em ms.
  MESSAGE_MIN_INTERVAL_MS: z.coerce.number().int().min(0).default(5000),
  /// Tempo máximo esperando a confirmação de um envio antes de marcar como resultado desconhecido.
  MESSAGE_SEND_TIMEOUT_MS: z.coerce.number().int().min(5000).default(30000),
  /// Retenção do histórico de tentativas, em dias (LGPD).
  RETENTION_DAYS: z.coerce.number().int().min(30).default(180),
});

export type WebEnv = z.infer<typeof webSchema>;
export type WorkerEnv = z.infer<typeof workerSchema>;

function parse<T extends z.ZodType>(schema: T, name: string): z.infer<T> {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Variáveis de ambiente inválidas (${name}):\n${issues}`);
  }
  return result.data;
}

let webEnv: WebEnv | undefined;
let workerEnv: WorkerEnv | undefined;

export function getWebEnv(): WebEnv {
  webEnv ??= parse(webSchema, "web");
  return webEnv;
}

export function getWorkerEnv(): WorkerEnv {
  workerEnv ??= parse(workerSchema, "worker");
  return workerEnv;
}
