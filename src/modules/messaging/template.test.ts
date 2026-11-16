import { describe, expect, it } from "vitest";
import { DEFAULT_MESSAGE_TEMPLATE, renderTemplate, usesVariable } from "./template";

const ctx = {
  name: "Maria",
  amount: "150.00",
  description: "mensalidade de dezembro",
  scheduledAt: new Date("2026-12-10T12:00:00.000Z"),
};

describe("renderTemplate", () => {
  it("preenche todas as variáveis", () => {
    expect(renderTemplate("{{nome}} | {{valor}} | {{descricao}} | {{data}}", ctx)).toBe(
      "Maria | 150,00 | mensalidade de dezembro | 10/12/2026",
    );
  });
  it("aceita espaços e maiúsculas dentro das chaves", () => {
    expect(renderTemplate("Oi {{ NOME }}", ctx)).toBe("Oi Maria");
  });
  it("mantém variáveis desconhecidas como estão", () => {
    expect(renderTemplate("{{outra}}", ctx)).toBe("{{outra}}");
  });
  it("valor vazio quando não há valor", () => {
    expect(renderTemplate("R$ {{valor}}", { ...ctx, amount: null })).toBe("R$ ");
  });
  it("modelo padrão usa nome, descrição e valor", () => {
    const text = renderTemplate(DEFAULT_MESSAGE_TEMPLATE, ctx);
    expect(text).toContain("Olá, Maria!");
    expect(text).toContain("no valor de R$ 150,00");
  });
  it("detecta uso de variável", () => {
    expect(usesVariable("R$ {{ valor }}", "valor")).toBe(true);
    expect(usesVariable("Olá {{nome}}", "valor")).toBe(false);
  });
});
