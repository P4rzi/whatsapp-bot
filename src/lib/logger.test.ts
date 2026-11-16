import { describe, expect, it } from "vitest";
import { maskPhone } from "./logger";

describe("maskPhone", () => {
  it("mascara o meio do telefone", () => {
    expect(maskPhone("5511987654321")).toBe("55119****4321");
  });
  it("ignora formatação", () => {
    expect(maskPhone("+55 (11) 98765-4321")).toBe("55119****4321");
  });
  it("lida com vazio e curto", () => {
    expect(maskPhone(null)).toBe("");
    expect(maskPhone("1234")).toBe("****");
  });
});
