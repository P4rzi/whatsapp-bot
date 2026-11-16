import { gunzipSync, gzipSync } from "node:zlib";
import { Prisma } from "@/generated/prisma/client";
import { decrypt, encrypt } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";

// Backup lógico do banco: exporta todas as tabelas do sistema para JSON, compacta (gzip) e
// criptografa (AES-256-GCM). Não depende do pg_dump (nem da versão do Postgres) e restaura
// com o próprio Prisma. Arquivos contêm dados pessoais: por isso são sempre criptografados.

export const BACKUP_FORMAT = "cobrancas-backup";
export const BACKUP_VERSION = 1;

/** Ordem de restauração (respeita as chaves estrangeiras). */
export const TABLES = [
  "user",
  "settings",
  "customer",
  "charge",
  "messageAttempt",
  "whatsAppConnection",
  "systemCommand",
] as const;
export type TableName = (typeof TABLES)[number];

export type BackupFile = {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  counts: Record<TableName, number>;
  tables: Record<TableName, Record<string, unknown>[]>;
};

type AnyDelegate = {
  findMany(args?: unknown): Promise<Record<string, unknown>[]>;
  deleteMany(args?: unknown): Promise<unknown>;
  createMany(args: { data: unknown[] }): Promise<unknown>;
};

function delegate(tx: unknown, table: TableName): AnyDelegate {
  return (tx as Record<string, AnyDelegate>)[table];
}

/** Converte Decimal e outros objetos para tipos JSON simples. */
function toPlain(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v instanceof Date) out[k] = v.toISOString();
    else if (Prisma.Decimal.isDecimal(v)) out[k] = (v as Prisma.Decimal).toString();
    else out[k] = v;
  }
  return out;
}

export async function exportDatabase(): Promise<BackupFile> {
  const tables = {} as BackupFile["tables"];
  const counts = {} as BackupFile["counts"];
  for (const table of TABLES) {
    const rows = await delegate(prisma, table).findMany();
    tables[table] = rows.map(toPlain);
    counts[table] = rows.length;
  }
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date().toISOString(), counts, tables };
}

export function packBackup(data: BackupFile, key: Buffer): Buffer {
  return encrypt(gzipSync(Buffer.from(JSON.stringify(data), "utf8")), key);
}

export function unpackBackup(payload: Buffer, key: Buffer): BackupFile {
  const data = JSON.parse(gunzipSync(decrypt(payload, key)).toString("utf8")) as BackupFile;
  if (data.format !== BACKUP_FORMAT) throw new Error("Arquivo não é um backup deste sistema.");
  if (data.version > BACKUP_VERSION) throw new Error(`Backup de versão mais nova (${data.version}); atualize o sistema.`);
  return data;
}

/**
 * Restaura um backup, SUBSTITUINDO todos os dados atuais (numa única transação: ou tudo, ou nada).
 * O batimento do worker não é restaurado (é recriado sozinho).
 */
export async function restoreDatabase(data: BackupFile) {
  await prisma.$transaction(
    async (tx) => {
      for (const table of [...TABLES].reverse()) await delegate(tx, table).deleteMany();
      for (const table of TABLES) {
        const rows = data.tables[table] ?? [];
        for (let i = 0; i < rows.length; i += 500) {
          await delegate(tx, table).createMany({ data: rows.slice(i, i + 500) });
        }
      }
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}

export function backupFileName(date = new Date()): string {
  return `backup-${date.toISOString().replace(/[:.]/g, "-").slice(0, 19)}.cbk`;
}
