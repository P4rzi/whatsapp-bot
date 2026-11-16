import { TZDate } from "@date-fns/tz";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";

// Datas são gravadas em UTC; toda entrada e exibição usa o fuso do negócio.
export const APP_TIMEZONE = process.env.NEXT_PUBLIC_TIMEZONE ?? "America/Sao_Paulo";

/** Data ("yyyy-MM-dd") + hora ("HH:mm") no fuso do negócio -> instante UTC. Null se inválido. */
export function localToUtc(date: string, time: string, tz: string = APP_TIMEZONE): Date | null {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time);
  if (!d || !t) return null;
  const [year, month, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
  const [hour, minute] = [Number(t[1]), Number(t[2])];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const local = new TZDate(year, month - 1, day, hour, minute, 0, tz);
  // Rejeita datas que "transbordam" (ex.: 31/02).
  if (local.getDate() !== day || local.getMonth() !== month - 1) return null;
  return new Date(local.getTime());
}

/** Formata um instante no fuso do negócio. Padrão: "dd/MM/yyyy HH:mm". */
export function formatInTz(date: Date, pattern = "dd/MM/yyyy HH:mm", tz: string = APP_TIMEZONE): string {
  return format(new TZDate(date.getTime(), tz), pattern, { locale: ptBR });
}

/** Sugestão de agendamento: a próxima hora cheia que esteja pelo menos 30 minutos à frente. */
export function suggestedSchedule(now: Date = new Date()): { date: string; time: string } {
  const d = new Date(now.getTime() + 90 * 60_000);
  d.setUTCMinutes(0, 0, 0);
  return utcToLocalParts(d);
}

/** Instante -> { date: "yyyy-MM-dd", time: "HH:mm" } no fuso do negócio (para preencher formulários). */
export function utcToLocalParts(date: Date, tz: string = APP_TIMEZONE): { date: string; time: string } {
  return { date: formatInTz(date, "yyyy-MM-dd", tz), time: formatInTz(date, "HH:mm", tz) };
}
