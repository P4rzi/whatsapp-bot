// Telefones são guardados só com dígitos e DDI (ex.: 5511987654321).

/**
 * Normaliza o telefone digitado. Números brasileiros sem DDI (10 ou 11 dígitos)
 * recebem o 55. Retorna null se o número for inválido.
 */
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/\D/g, "");
  // Com "+" na frente, o número já traz o código do país.
  const hasCountryCode = input.trim().startsWith("+");
  if (!hasCountryCode && (digits.length === 10 || digits.length === 11)) digits = `55${digits}`;
  if (digits.length < (hasCountryCode ? 8 : 12) || digits.length > 15) return null;
  // Brasil: DDI 55 + DDD (2) + número (8 ou 9 dígitos).
  if (digits.startsWith("55") && digits.length !== 12 && digits.length !== 13) return null;
  return digits;
}

/** 5511987654321 -> +55 (11) 98765-4321. Outros países: +<dígitos>. */
export function formatPhone(digits: string): string {
  if (digits.startsWith("55") && (digits.length === 12 || digits.length === 13)) {
    const ddd = digits.slice(2, 4);
    const number = digits.slice(4);
    const split = number.length === 9 ? 5 : 4;
    return `+55 (${ddd}) ${number.slice(0, split)}-${number.slice(split)}`;
  }
  return `+${digits}`;
}
