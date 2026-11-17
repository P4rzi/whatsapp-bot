import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  BufferJSON,
  initAuthCreds,
  proto,
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataSet,
  type SignalDataTypeMap,
} from "@whiskeysockets/baileys";
import { decrypt, encrypt } from "@/lib/crypto";
import { ProviderFatalError } from "@/modules/whatsapp/provider";

// Armazenamento persistente da sessão do WhatsApp (credenciais + chaves Signal).
// - Cada item vira um arquivo criptografado (AES-256-GCM) dentro da pasta da sessão.
// - Escrita atômica: grava num arquivo temporário, força o disco (fsync) e renomeia.
// - Um lock por arquivo evita leituras/escritas concorrentes no mesmo item.
// - O nome do arquivo é um hash do item, para não expor números de telefone no disco.

class KeyedMutex {
  private tails = new Map<string, Promise<void>>();

  async run<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((r) => (release = r));
    const tail = previous.then(() => current);
    this.tails.set(key, tail);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}

const EXT = ".enc";

function fileNameFor(item: string): string {
  return createHash("sha256").update(item).digest("hex").slice(0, 40) + EXT;
}

export async function writeFileAtomic(filePath: string, data: Buffer) {
  const tmp = `${filePath}.${randomBytes(6).toString("hex")}.tmp`;
  const handle = await open(tmp, "w", 0o600);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(tmp, filePath);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  }
}

export type EncryptedAuthState = {
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  /** Espera todas as escritas em andamento chegarem ao disco. */
  flush: () => Promise<void>;
  /** Apaga a sessão inteira (usado no logout). */
  clear: () => Promise<void>;
};

export async function openEncryptedAuthState(folder: string, key: Buffer): Promise<EncryptedAuthState> {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const mutex = new KeyedMutex();

  async function read<T>(item: string): Promise<T | null> {
    const file = path.join(folder, fileNameFor(item));
    return mutex.run(file, async () => {
      let raw: Buffer;
      try {
        raw = await readFile(file);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
      // Erro de decifragem propaga: chave errada não pode virar "sessão vazia" silenciosamente.
      let plain: Buffer;
      try {
        plain = decrypt(raw, key);
      } catch {
        throw new ProviderFatalError(
          "A sessão salva do WhatsApp não abre com a ENCRYPTION_KEY atual (a chave mudou ou o arquivo foi alterado). " +
            "Volte a chave anterior ou clique em Desconectar e depois Conectar para gerar uma sessão nova.",
        );
      }
      return JSON.parse(plain.toString("utf8"), BufferJSON.reviver) as T;
    });
  }

  // Escritas em andamento: flush() espera por elas (ex.: antes de reconectar logo após o QR).
  const inFlight = new Set<Promise<unknown>>();
  function track<T>(p: Promise<T>): Promise<T> {
    inFlight.add(p);
    p.finally(() => inFlight.delete(p)).catch(() => {});
    return p;
  }

  async function write(item: string, value: unknown) {
    const file = path.join(folder, fileNameFor(item));
    const data = encrypt(Buffer.from(JSON.stringify(value, BufferJSON.replacer), "utf8"), key);
    await track(mutex.run(file, () => writeFileAtomic(file, data)));
  }

  async function remove(item: string) {
    const file = path.join(folder, fileNameFor(item));
    await track(mutex.run(file, () => unlink(file).catch(() => {})));
  }

  const creds: AuthenticationCreds = (await read<AuthenticationCreds>("creds")) ?? initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        async get<T extends keyof SignalDataTypeMap>(type: T, ids: string[]) {
          const out: { [id: string]: SignalDataTypeMap[T] } = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await read<SignalDataTypeMap[T]>(`${type}:${id}`);
              if (type === "app-state-sync-key" && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(
                  value as unknown as Record<string, unknown>,
                ) as unknown as SignalDataTypeMap[T];
              }
              if (value !== null) out[id] = value;
            }),
          );
          return out;
        },
        async set(data: SignalDataSet) {
          const tasks: Promise<void>[] = [];
          for (const category of Object.keys(data) as (keyof SignalDataTypeMap)[]) {
            const entries = data[category] ?? {};
            for (const id of Object.keys(entries)) {
              const value = entries[id];
              const item = `${category}:${id}`;
              tasks.push(value ? write(item, value) : remove(item));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => write("creds", creds),
    flush: async () => {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
    },
    clear: async () => {
      while (inFlight.size > 0) await Promise.allSettled([...inFlight]);
      for (const name of await readdir(folder)) {
        if (name.endsWith(EXT) || name.endsWith(".tmp")) await rm(path.join(folder, name), { force: true });
      }
    },
  };
}

/** Existe sessão salva e já autenticada (não precisa de QR)? */
export async function hasRegisteredSession(folder: string, key: Buffer): Promise<boolean> {
  try {
    const raw = await readFile(path.join(folder, fileNameFor("creds")));
    const creds = JSON.parse(decrypt(raw, key).toString("utf8"), BufferJSON.reviver) as AuthenticationCreds;
    return !!creds.registered || !!creds.me?.id;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Lock da pasta: impede que dois workers usem a mesma sessão ao mesmo tempo.
// ---------------------------------------------------------------------------

const LOCK_FILE = ".worker.lock";
/** Lock sem atualização há mais que isso é considerado abandonado (worker morreu). */
const LOCK_STALE_MS = 90_000;

export class SessionLockedError extends Error {}

/** O lock está com outra instância ativa? */
async function lockedByOther(file: string, instanceId: string): Promise<boolean> {
  try {
    const [content, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    return Date.now() - info.mtimeMs < LOCK_STALE_MS && content.trim() !== instanceId;
  } catch {
    return false; // sem lock
  }
}

/**
 * Pega o lock da pasta da sessão. Se outra instância estiver com ele, espera até `waitMs`
 * (cobre o caso de um worker que morreu sem liberar: o lock vence em LOCK_STALE_MS).
 */
export async function acquireSessionLock(folder: string, instanceId: string, waitMs = LOCK_STALE_MS + 15_000) {
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const file = path.join(folder, LOCK_FILE);
  const deadline = Date.now() + waitMs;
  while (await lockedByOther(file, instanceId)) {
    if (Date.now() >= deadline) {
      throw new SessionLockedError(
        "Outra instância do worker está usando esta sessão do WhatsApp. Só pode haver um worker por sessão.",
      );
    }
    await new Promise((r) => setTimeout(r, 5_000));
  }
  await writeFile(file, instanceId, { mode: 0o600 });

  const timer = setInterval(() => {
    writeFile(file, instanceId).catch(() => {});
  }, LOCK_STALE_MS / 3);
  timer.unref();

  return async function release() {
    clearInterval(timer);
    try {
      if ((await readFile(file, "utf8")).trim() === instanceId) await unlink(file);
    } catch {
      // já removido
    }
  };
}
