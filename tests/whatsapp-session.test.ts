import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decrypt, encrypt, parseKey } from "@/lib/crypto";
import { ProviderFatalError } from "@/modules/whatsapp/provider";
import {
  acquireSessionLock,
  hasRegisteredSession,
  SessionLockedError,
  openEncryptedAuthState,
  writeFileAtomic,
} from "@/worker/whatsapp/session";

const key = randomBytes(32);
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "wa-session-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("criptografia AES-256-GCM", () => {
  it("cifra e decifra", () => {
    const data = Buffer.from("segredo");
    const enc = encrypt(data, key);
    expect(enc.includes(data)).toBe(false);
    expect(decrypt(enc, key).toString()).toBe("segredo");
  });
  it("falha com chave errada ou dado alterado", () => {
    const enc = encrypt(Buffer.from("segredo"), key);
    expect(() => decrypt(enc, randomBytes(32))).toThrow();
    enc[enc.length - 1] ^= 1;
    expect(() => decrypt(enc, key)).toThrow();
  });
  it("valida o formato da chave", () => {
    expect(() => parseKey("curta")).toThrow();
    expect(parseKey("a".repeat(64))).toHaveLength(32);
  });
});

describe("sessão do WhatsApp em disco", () => {
  it("persiste credenciais e chaves criptografadas e recupera depois de reiniciar", async () => {
    const first = await openEncryptedAuthState(dir, key);
    first.state.creds.registered = true;
    await first.saveCreds();
    await first.state.keys.set({ session: { "5511999990000.0": new Uint8Array([1, 2, 3]) }, "lid-mapping": { a: "b" } });

    // Nada legível no disco (nem o telefone no nome do arquivo).
    for (const name of await readdir(dir)) {
      expect(name).not.toContain("5511");
      const raw = await readFile(path.join(dir, name));
      expect(raw.toString("latin1")).not.toContain("registered");
    }

    // "Reinício": novo objeto lendo a mesma pasta.
    const second = await openEncryptedAuthState(dir, key);
    expect(second.state.creds.registered).toBe(true);
    const sessions = await second.state.keys.get("session", ["5511999990000.0", "inexistente"]);
    expect(Array.from(sessions["5511999990000.0"])).toEqual([1, 2, 3]);
    expect(sessions["inexistente"]).toBeUndefined();
    expect((await second.state.keys.get("lid-mapping", ["a"]))["a"]).toBe("b");
    expect(await hasRegisteredSession(dir, key)).toBe(true);
  });

  it("flush() garante que credenciais salvas sem esperar já estão no disco (reinício logo após o QR)", async () => {
    const s = await openEncryptedAuthState(dir, key);
    s.state.creds.registered = true;
    s.state.creds.me = { id: "5511999990000:1@s.whatsapp.net" };
    void s.saveCreds(); // como no evento creds.update: não é aguardado
    await s.flush();
    expect(await hasRegisteredSession(dir, key)).toBe(true);
    const reopened = await openEncryptedAuthState(dir, key);
    expect(reopened.state.creds.me?.id).toBe("5511999990000:1@s.whatsapp.net");
  });

  it("clear() espera escritas pendentes, para não sobrar arquivo depois do logout", async () => {
    const s = await openEncryptedAuthState(dir, key);
    void s.saveCreds();
    void s.state.keys.set({ session: { a: new Uint8Array([1]) } });
    await s.clear();
    expect((await readdir(dir)).filter((n) => n.endsWith(".enc"))).toEqual([]);
  });

  it("remove chaves com valor null", async () => {
    const s = await openEncryptedAuthState(dir, key);
    await s.state.keys.set({ "sender-key": { x: new Uint8Array([9]) } });
    await s.state.keys.set({ "sender-key": { x: null } });
    expect(await s.state.keys.get("sender-key", ["x"])).toEqual({});
  });

  it("não aceita chave de criptografia errada (não vira sessão vazia em silêncio)", async () => {
    const s = await openEncryptedAuthState(dir, key);
    await s.saveCreds();
    await expect(openEncryptedAuthState(dir, randomBytes(32))).rejects.toThrow();
    expect(await hasRegisteredSession(dir, randomBytes(32))).toBe(false);
  });

  it("clear() apaga a sessão", async () => {
    const s = await openEncryptedAuthState(dir, key);
    s.state.creds.registered = true;
    await s.saveCreds();
    await s.clear();
    expect(await hasRegisteredSession(dir, key)).toBe(false);
    expect((await readdir(dir)).filter((n) => n.endsWith(".enc"))).toEqual([]);
  });

  it("escritas concorrentes no mesmo item não corrompem o arquivo", async () => {
    const s = await openEncryptedAuthState(dir, key);
    await Promise.all(
      Array.from({ length: 30 }, (_, i) => s.state.keys.set({ "app-state-sync-version": { v: { version: i, hash: Buffer.alloc(4), indexValueMap: {} } } })),
    );
    const v = (await s.state.keys.get("app-state-sync-version", ["v"]))["v"];
    expect(typeof v.version).toBe("number");
    expect((await readdir(dir)).some((n) => n.endsWith(".tmp"))).toBe(false);
  });

  it("escrita atômica substitui o arquivo inteiro", async () => {
    const file = path.join(dir, "x.bin");
    await writeFile(file, "antigo");
    await writeFileAtomic(file, Buffer.from("novo"));
    expect(await readFile(file, "utf8")).toBe("novo");
  });
});

describe("lock da sessão (um worker por sessão)", () => {
  it("bloqueia uma segunda instância enquanto a primeira está ativa", async () => {
    const release = await acquireSessionLock(dir, "worker-A");
    await expect(acquireSessionLock(dir, "worker-B", 0)).rejects.toBeInstanceOf(SessionLockedError);
    await release();
    const releaseB = await acquireSessionLock(dir, "worker-B");
    await releaseB();
  });

  it("assume um lock abandonado (worker anterior morreu)", async () => {
    await writeFile(path.join(dir, ".worker.lock"), "worker-morto");
    const old = new Date(Date.now() - 5 * 60_000);
    await utimes(path.join(dir, ".worker.lock"), old, old);
    const release = await acquireSessionLock(dir, "worker-novo");
    await release();
  });
});

describe("chave errada vira erro explicativo", () => {
  it("abrir a sessão com outra chave lança ProviderFatalError com instruções", async () => {
    const s = await openEncryptedAuthState(dir, key);
    await s.saveCreds();
    const err = await openEncryptedAuthState(dir, randomBytes(32)).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderFatalError);
    expect(String(err.message)).toMatch(/ENCRYPTION_KEY/);
  });
});
