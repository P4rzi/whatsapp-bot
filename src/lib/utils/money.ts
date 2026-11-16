// Valores monetários trafegam como string decimal ("1234.56") para não perder precisão.

/**
 * Converte o valor digitado em string decimal com 2 casas.
 * Aceita "1.234,56", "1234,56", "1234.56", "R$ 50". Retorna null se vazio ou inválido.
 */
export function parseMoney(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.replace(/R\$|\s/g, "");
  if (!s) return null;
  if (s.includes(",")) {
    // Formato brasileiro: ponto = milhar, vírgula = decimal.
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^\d+\.\d{1,2}$/.test(s)) {
    // "1234.56": ponto como decimal.
  } else {
    // "1.234": pontos como milhar.
    s = s.replace(/\./g, "");
  }
  if (!/^\d{1,10}(\.\d{1,2})?$/.test(s)) return null;
  return Number(s).toFixed(2);
}

const brl = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "1234.5" -> "1.234,50" (sem o símbolo R$). */
export function formatMoney(value: string | number | { toString(): string } | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  const n = typeof value === "number" ? value : Number(value.toString());
  return Number.isFinite(n) ? brl.format(n) : "";
}
