import { describe, expect, it } from "vitest";
import { formatInTz } from "@/lib/utils/datetime";
import { nextOccurrence } from "./charge.repeat";

const brt = (d: Date) => formatInTz(d);

describe("repetir cobrança no próximo mês", () => {
  const now = new Date("2026-01-01T00:00:00Z");

  it("mesmo dia e horário (de Brasília) no mês seguinte", () => {
    expect(brt(nextOccurrence(new Date("2026-01-10T12:30:00Z"), now))).toBe("10/02/2026 09:30");
  });
  it("dia 31 vira o último dia do mês quando o mês é menor", () => {
    expect(brt(nextOccurrence(new Date("2026-01-31T13:00:00Z"), now))).toBe("28/02/2026 10:00");
  });
  it("cobrança antiga avança até o próximo mês no futuro, sem perder o dia original", () => {
    const old = new Date("2025-01-31T13:00:00Z");
    expect(brt(nextOccurrence(old, new Date("2025-03-05T00:00:00Z")))).toBe("31/03/2025 10:00");
  });
  it("vira o ano", () => {
    expect(brt(nextOccurrence(new Date("2026-12-15T15:00:00Z"), new Date("2026-12-01T00:00:00Z")))).toBe("15/01/2027 12:00");
  });
});
