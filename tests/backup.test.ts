import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { exportDatabase, packBackup, restoreDatabase, unpackBackup } from "@/modules/backup/backup";
import { LocalBackupStorage, pruneBackups } from "@/modules/backup/storage";
import { createTestCustomer, resetDb } from "./db";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

const key = randomBytes(32);

async function seed() {
  await prisma.user.create({ data: { name: "Admin", email: "a@b.com", passwordHash: "hash" } });
  await prisma.settings.create({ data: { id: "default", defaultMessageTemplate: "Oi {{nome}}" } });
  const c = await createTestCustomer({ name: "Maria" });
  const ch = await prisma.charge.create({
    data: { customerId: c.id, description: "Mensalidade", amount: "150.50", message: "x", scheduledAt: new Date("2030-01-01T12:00:00Z"), status: "SENT" },
  });
  await prisma.messageAttempt.create({ data: { chargeId: ch.id, attemptNumber: 1, status: "SUCCESS", providerMessageId: "M1" } });
  await prisma.systemCommand.create({ data: { type: "CONNECT_WHATSAPP", payload: { origem: "teste" } } });
  return { c, ch };
}

describe("backup do banco", () => {
  it("exporta, criptografa e restaura todos os dados", async () => {
    const { c, ch } = await seed();
    const data = await exportDatabase();
    expect(data.counts).toMatchObject({ user: 1, settings: 1, customer: 1, charge: 1, messageAttempt: 1, systemCommand: 1 });

    const payload = packBackup(data, key);
    expect(payload.toString("latin1")).not.toContain("Maria"); // criptografado

    // Simula perda de dados e restaura.
    await resetDb();
    expect(await prisma.customer.count()).toBe(0);
    await restoreDatabase(unpackBackup(payload, key));

    const customer = await prisma.customer.findUniqueOrThrow({ where: { id: c.id } });
    expect(customer.name).toBe("Maria");
    expect(customer.consentAt).toBeInstanceOf(Date);
    const charge = await prisma.charge.findUniqueOrThrow({ where: { id: ch.id }, include: { attempts: true } });
    expect(charge.amount?.toString()).toBe("150.5");
    expect(charge.scheduledAt.toISOString()).toBe("2030-01-01T12:00:00.000Z");
    expect(charge.attempts[0].providerMessageId).toBe("M1");
    expect((await prisma.systemCommand.findFirstOrThrow()).payload).toEqual({ origem: "teste" });
    expect((await prisma.settings.findUniqueOrThrow({ where: { id: "default" } })).defaultMessageTemplate).toBe("Oi {{nome}}");
  });

  it("restaurar substitui os dados atuais (não duplica)", async () => {
    await seed();
    const payload = packBackup(await exportDatabase(), key);
    await createTestCustomer({ name: "Criado depois", phone: "5511900000009" });
    await restoreDatabase(unpackBackup(payload, key));
    expect(await prisma.customer.count()).toBe(1);
  });

  it("recusa chave errada e arquivo adulterado", async () => {
    await seed();
    const payload = packBackup(await exportDatabase(), key);
    expect(() => unpackBackup(payload, randomBytes(32))).toThrow();
    payload[payload.length - 1] ^= 1;
    expect(() => unpackBackup(payload, key)).toThrow();
  });
});

describe("armazenamento dos backups", () => {
  it("guarda, lista em ordem e mantém só os N mais recentes", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "backups-"));
    try {
      const storage = new LocalBackupStorage(dir);
      for (const d of ["2026-01-01", "2026-01-02", "2026-01-03", "2026-01-04"]) {
        await storage.put(`backup-${d}T00-00-00.cbk`, Buffer.from(d));
      }
      await storage.put("outro-arquivo.txt", Buffer.from("ignorar"));
      expect(await storage.list()).toHaveLength(4);
      const removed = await pruneBackups(storage, 2);
      expect(removed).toEqual(["backup-2026-01-01T00-00-00.cbk", "backup-2026-01-02T00-00-00.cbk"]);
      expect(await storage.list()).toEqual(["backup-2026-01-03T00-00-00.cbk", "backup-2026-01-04T00-00-00.cbk"]);
      expect((await storage.get("backup-2026-01-04T00-00-00.cbk")).toString()).toBe("2026-01-04");
      expect(await readFile(path.join(dir, "outro-arquivo.txt"), "utf8")).toBe("ignorar");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
