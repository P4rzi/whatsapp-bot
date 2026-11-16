// Gera um backup criptografado do banco e guarda no armazenamento configurado.
// Pensado para rodar como serviço agendado (cron) no Railway: executa e termina.
//
// Variáveis:
//   DATABASE_URL                 banco de origem
//   BACKUP_ENCRYPTION_KEY        64 caracteres hex (guarde fora do Railway também!)
//   BACKUP_KEEP                  quantos backups manter (padrão 14)
//   BACKUP_S3_BUCKET/ENDPOINT/REGION/ACCESS_KEY_ID/SECRET_ACCESS_KEY   destino S3 (opcional)
//   BACKUP_DIR                   destino local se não houver S3 (padrão ./backups)
import { parseKey } from "@/lib/crypto";
import { createLogger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { backupFileName, exportDatabase, packBackup } from "@/modules/backup/backup";
import { pruneBackups, storageFromEnv } from "@/modules/backup/storage";

const logger = createLogger("backup");

async function main() {
  const keyHex = process.env.BACKUP_ENCRYPTION_KEY;
  if (!keyHex) throw new Error("Defina BACKUP_ENCRYPTION_KEY (64 caracteres hex).");
  const key = parseKey(keyHex);
  const keep = Number(process.env.BACKUP_KEEP ?? 14);
  const storage = storageFromEnv();

  const started = Date.now();
  const data = await exportDatabase();
  const payload = packBackup(data, key);
  const name = backupFileName();
  await storage.put(name, payload);
  const removed = await pruneBackups(storage, keep);

  logger.info(
    { name, bytes: payload.length, counts: data.counts, destination: storage.describe(), removed: removed.length, ms: Date.now() - started },
    "backup concluído",
  );
}

main()
  .catch((err) => {
    logger.fatal({ err }, "falha no backup");
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
