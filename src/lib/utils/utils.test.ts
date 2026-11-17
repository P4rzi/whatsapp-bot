import { describe, expect, it } from "vitest";
import { formatInTz, localToUtc, utcToLocalParts } from "./datetime";
import { formatMoney, parseMoney } from "./money";
import { formatPhone, normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it("adiciona o 55 em números brasileiros sem DDI", () => {
    expect(normalizePhone("(11) 98765-4321")).toBe("5511987654321");
    expect(normalizePhone("11 3456-7890")).toBe("551134567890");
  });
  it("mantém números com DDI", () => {
    expect(normalizePhone("+55 11 98765-4321")).toBe("5511987654321");
    expect(normalizePhone("+1 415 555 2671")).toBe("14155552671");
  });
  it("ignora o 0 antes do DDD e entende o prefixo internacional 00", () => {
    expect(normalizePhone("011 98765-4321")).toBe("5511987654321");
    expect(normalizePhone("(011) 3456-7890")).toBe("551134567890");
    expect(normalizePhone("0055 11 98765-4321")).toBe("5511987654321");
    expect(normalizePhone("001 415 555 2671")).toBe("14155552671");
  });
  it("rejeita números inválidos", () => {
    expect(normalizePhone("1234")).toBeNull();
    expect(normalizePhone("55119876543210")).toBeNull(); // 55 com 14 dígitos
    expect(normalizePhone("")).toBeNull();
  });
  it("formata para exibição", () => {
    expect(formatPhone("5511987654321")).toBe("+55 (11) 98765-4321");
    expect(formatPhone("551134567890")).toBe("+55 (11) 3456-7890");
    expect(formatPhone("14155552671")).toBe("+14155552671");
  });
});

describe("parseMoney / formatMoney", () => {
  it("entende o formato brasileiro", () => {
    expect(parseMoney("1.234,56")).toBe("1234.56");
    expect(parseMoney("R$ 150,5")).toBe("150.50");
    expect(parseMoney("50")).toBe("50.00");
    expect(parseMoney("1.500")).toBe("1500.00");
    expect(parseMoney("99.90")).toBe("99.90");
  });
  it("rejeita valores inválidos", () => {
    expect(parseMoney("abc")).toBeNull();
    expect(parseMoney("1,2,3")).toBeNull();
    expect(parseMoney("")).toBeNull();
  });
  it("formata sem o símbolo", () => {
    expect(formatMoney("1234.5")).toBe("1.234,50");
    expect(formatMoney(null)).toBe("");
  });
});

describe("conversão de fuso (America/Sao_Paulo)", () => {
  it("converte horário de Brasília para UTC (+3h)", () => {
    expect(localToUtc("2026-12-01", "09:30")?.toISOString()).toBe("2026-12-01T12:30:00.000Z");
  });
  it("vira o dia corretamente perto da meia-noite", () => {
    expect(localToUtc("2026-12-31", "22:00")?.toISOString()).toBe("2027-01-01T01:00:00.000Z");
  });
  it("faz o caminho de volta para exibição", () => {
    const utc = new Date("2026-12-01T12:30:00.000Z");
    expect(formatInTz(utc)).toBe("01/12/2026 09:30");
    expect(utcToLocalParts(utc)).toEqual({ date: "2026-12-01", time: "09:30" });
  });
  it("rejeita datas inexistentes", () => {
    expect(localToUtc("2026-02-31", "10:00")).toBeNull();
    expect(localToUtc("2026-12-01", "25:00")).toBeNull();
    expect(localToUtc("01/12/2026", "10:00")).toBeNull();
  });
});
