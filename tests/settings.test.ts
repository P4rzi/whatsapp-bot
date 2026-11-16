import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/prisma";
import { DEFAULT_MESSAGE_TEMPLATE } from "@/modules/messaging/template";
import { messageTemplateSchema, passwordChangeSchema } from "@/modules/settings/settings.schema";
import { getDefaultMessageTemplate, saveDefaultMessageTemplate } from "@/modules/settings/settings.service";
import { resetDb } from "./db";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("troca de senha (validação)", () => {
  const ok = { currentPassword: "senha atual 123", newPassword: "nova senha longa", confirmPassword: "nova senha longa" };
  it("aceita dados válidos", () => {
    expect(passwordChangeSchema.safeParse(ok).success).toBe(true);
  });
  it("exige mínimo de caracteres, confirmação igual e senha diferente da atual", () => {
    expect(passwordChangeSchema.safeParse({ ...ok, newPassword: "curta", confirmPassword: "curta" }).success).toBe(false);
    expect(passwordChangeSchema.safeParse({ ...ok, confirmPassword: "outra coisa" }).success).toBe(false);
    expect(
      passwordChangeSchema.safeParse({ ...ok, newPassword: ok.currentPassword, confirmPassword: ok.currentPassword }).success,
    ).toBe(false);
  });
});

describe("mensagem padrão", () => {
  it("usa o modelo original enquanto nada foi salvo e depois o salvo", async () => {
    expect(await getDefaultMessageTemplate()).toBe(DEFAULT_MESSAGE_TEMPLATE);
    await saveDefaultMessageTemplate("Oi {{nome}}");
    expect(await getDefaultMessageTemplate()).toBe("Oi {{nome}}");
  });
  it("não aceita mensagem vazia", () => {
    expect(messageTemplateSchema.safeParse({ defaultMessageTemplate: "   " }).success).toBe(false);
  });
});
