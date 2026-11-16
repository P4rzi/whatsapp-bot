// Restaura um backup, SUBSTITUINDO todos os dados do banco de destino.
//
// Uso:
//   npm run restore -- --list                     lista os backups disponíveis
//   npm run restore -- --file NOME --confirm      restaura (NOME = um item da lista, ou "latest")
//
// Por segurança, se NODE_ENV=production é preciso também RESTORE_ALLOW_PRODUCTION=sim.
// Recomendado: testar a restauração no banco de DESENVOLVIMENTO.
import { readFile } from "node:fs/promises";
import { parseKey } from "@/lib/crypto";
import { prisma } from "@/lib/prisma";
import { restoreDatabase, unpackBackup } from "@/modules/backup/backup";
import { storageFromEnv } from "@/modules/backup/storage";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const storage = storageFromEnv();

  if (process.argv.includes("--list")) {
    const names = await storage.list();
    console.log(`Backups em ${storage.describe()}:`);
    for (const n of names) console.log(`  ${n}`);
    if (!names.length) console.log("  (nenhum)");
    return;
  }

  const file = arg("--file");
  if (!file) throw new Error("Informe --file NOME (ou --list para ver os backups).");
  if (!process.argv.includes("--confirm")) {
    throw new Error("Restaurar APAGA os dados atuais do banco de destino. Repita com --confirm para continuar.");
  }
  if (process.env.NODE_ENV === "production" && process.env.RESTORE_ALLOW_PRODUCTION !== "sim") {
    throw new Error("Restauração em produção bloqueada. Defina RESTORE_ALLOW_PRODUCTION=sim se for realmente isso.");
  }

  const keyHex = process.env.BACKUP_ENCRYPTION_KEY;
  if (!keyHex) throw new Error("Defina BACKUP_ENCRYPTION_KEY (a mesma usada para gerar o backup).");

  let payload: Buffer;
  if (file === "latest") {
    const latest = (await storage.list()).at(-1);
    if (!latest) throw new Error("Nenhum backup encontrado.");
    payload = await storage.get(latest);
    console.log(`Usando o backup mais recente: ${latest}`);
  } else if (file.includes("/") || file.includes("\\")) {
    payload = await readFile(file); // caminho de arquivo baixado manualmente
  } else {
    payload = await storage.get(file);
  }

  const data = unpackBackup(payload, parseKey(keyHex));
  console.log(`Backup de ${data.createdAt}:`, data.counts);
  await restoreDatabase(data);
  console.log("Restauração concluída.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
