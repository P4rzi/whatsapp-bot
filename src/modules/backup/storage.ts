import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

// Onde os backups ficam: armazenamento compatível com S3 (Bucket do Railway, Cloudflare R2,
// Backblaze B2, AWS S3) ou uma pasta local (desenvolvimento e testes).

export interface BackupStorage {
  describe(): string;
  put(name: string, data: Buffer): Promise<void>;
  get(name: string): Promise<Buffer>;
  /** Nomes dos backups, do mais antigo para o mais novo. */
  list(): Promise<string[]>;
  remove(name: string): Promise<void>;
}

const PREFIX = "backups/";
const isBackup = (name: string) => /^backup-.*\.cbk$/.test(name);

export class LocalBackupStorage implements BackupStorage {
  constructor(private readonly dir: string) {}
  describe() {
    return `pasta local ${this.dir}`;
  }
  async put(name: string, data: Buffer) {
    await mkdir(this.dir, { recursive: true });
    await writeFile(path.join(this.dir, name), data, { mode: 0o600 });
  }
  get(name: string) {
    return readFile(path.join(this.dir, path.basename(name)));
  }
  async list() {
    try {
      return (await readdir(this.dir)).filter(isBackup).sort();
    } catch {
      return [];
    }
  }
  async remove(name: string) {
    await rm(path.join(this.dir, path.basename(name)), { force: true });
  }
}

export type S3Config = {
  bucket: string;
  endpoint?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
};

export class S3BackupStorage implements BackupStorage {
  private client: S3Client;
  constructor(private readonly cfg: S3Config) {
    this.client = new S3Client({
      region: cfg.region,
      endpoint: cfg.endpoint,
      forcePathStyle: !!cfg.endpoint,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
    });
  }
  describe() {
    return `bucket ${this.cfg.bucket}${this.cfg.endpoint ? ` (${new URL(this.cfg.endpoint).host})` : ""}`;
  }
  async put(name: string, data: Buffer) {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.cfg.bucket, Key: PREFIX + name, Body: data, ContentType: "application/octet-stream" }),
    );
  }
  async get(name: string) {
    const res = await this.client.send(new GetObjectCommand({ Bucket: this.cfg.bucket, Key: PREFIX + path.basename(name) }));
    return Buffer.from(await res.Body!.transformToByteArray());
  }
  async list() {
    const names: string[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({ Bucket: this.cfg.bucket, Prefix: PREFIX, ContinuationToken: token }),
      );
      for (const obj of res.Contents ?? []) {
        const name = obj.Key?.slice(PREFIX.length);
        if (name && isBackup(name)) names.push(name);
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return names.sort();
  }
  async remove(name: string) {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.cfg.bucket, Key: PREFIX + path.basename(name) }));
  }
}

/** Escolhe o armazenamento pelas variáveis de ambiente. */
export function storageFromEnv(env: NodeJS.ProcessEnv = process.env): BackupStorage {
  if (env.BACKUP_S3_BUCKET) {
    const missing = ["BACKUP_S3_ACCESS_KEY_ID", "BACKUP_S3_SECRET_ACCESS_KEY"].filter((k) => !env[k]);
    if (missing.length) throw new Error(`Faltam variáveis para o backup em S3: ${missing.join(", ")}`);
    return new S3BackupStorage({
      bucket: env.BACKUP_S3_BUCKET,
      endpoint: env.BACKUP_S3_ENDPOINT || undefined,
      region: env.BACKUP_S3_REGION || "auto",
      accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID!,
      secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY!,
    });
  }
  return new LocalBackupStorage(path.resolve(env.BACKUP_DIR || "./backups"));
}

/** Mantém só os `keep` backups mais recentes. Retorna os nomes apagados. */
export async function pruneBackups(storage: BackupStorage, keep: number): Promise<string[]> {
  const all = await storage.list();
  const old = all.slice(0, Math.max(0, all.length - keep));
  for (const name of old) await storage.remove(name);
  return old;
}
