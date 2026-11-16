import { addMonthsInTz } from "@/lib/utils/datetime";

/**
 * Próxima ocorrência mensal de uma cobrança: mesmo dia e horário no mês seguinte.
 * Se a cobrança original for antiga, avança mês a mês até cair no futuro.
 */
export function nextOccurrence(scheduledAt: Date, now: Date = new Date()): Date {
  let months = 1;
  let next = addMonthsInTz(scheduledAt, months);
  while (next.getTime() <= now.getTime() && months < 240) {
    months++;
    next = addMonthsInTz(scheduledAt, months); // sempre a partir do original (31/01 -> 28/02 -> 31/03)
  }
  return next;
}
