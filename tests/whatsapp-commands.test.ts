import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  claimNextCommand,
  completeCommand,
  enqueueCommand,
  expireStaleCommands,
} from "@/modules/whatsapp/command.repository";
import { resetDb } from "./db";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("fila de comandos painel -> worker", () => {
  it("não empilha o mesmo comando pendente duas vezes", async () => {
    const a = await enqueueCommand("CONNECT_WHATSAPP");
    const b = await enqueueCommand("CONNECT_WHATSAPP");
    expect(b.id).toBe(a.id);
    expect(await prisma.systemCommand.count()).toBe(1);
  });

  it("reserva comandos em ordem e marca o resultado", async () => {
    await enqueueCommand("CONNECT_WHATSAPP");
    await new Promise((r) => setTimeout(r, 5));
    await enqueueCommand("RESTART_WHATSAPP");
    const first = await claimNextCommand();
    expect(first?.type).toBe("CONNECT_WHATSAPP");
    await completeCommand(first!.id);
    const second = await claimNextCommand();
    expect(second?.type).toBe("RESTART_WHATSAPP");
    await completeCommand(second!.id, "falhou");
    expect(await claimNextCommand()).toBeNull();
    const rows = await prisma.systemCommand.findMany({ orderBy: { createdAt: "asc" } });
    expect(rows.map((r) => r.status)).toEqual(["DONE", "FAILED"]);
    expect(rows[1].error).toBe("falhou");
  });

  it("execuções simultâneas nunca pegam o mesmo comando (SKIP LOCKED)", async () => {
    await prisma.systemCommand.createMany({
      data: Array.from({ length: 10 }, () => ({ type: "CONNECT_WHATSAPP" as const })),
    });
    const claims = await Promise.all(Array.from({ length: 20 }, () => claimNextCommand()));
    const ids = claims.filter(Boolean).map((c) => c!.id);
    expect(ids).toHaveLength(10);
    expect(new Set(ids).size).toBe(10);
  });

  it("ao reiniciar, descarta comandos interrompidos e muito antigos", async () => {
    await prisma.systemCommand.create({ data: { type: "CONNECT_WHATSAPP", status: "PROCESSING" } });
    await prisma.systemCommand.create({
      data: { type: "RESTART_WHATSAPP", createdAt: new Date(Date.now() - 60 * 60_000) },
    });
    await prisma.systemCommand.create({ data: { type: "DISCONNECT_WHATSAPP" } });
    expect(await expireStaleCommands()).toEqual({ interrupted: 1, expired: 1 });
    const pending = await prisma.systemCommand.findMany({ where: { status: "PENDING" } });
    expect(pending.map((p) => p.type)).toEqual(["DISCONNECT_WHATSAPP"]);
  });
});
