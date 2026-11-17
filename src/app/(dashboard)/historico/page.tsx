import type { Metadata } from "next";
import Link from "next/link";
import { ChargeStatusBadge } from "@/components/charges/charge-status-badge";
import { RetryChargeButton } from "@/components/charges/retry-charge-button";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { formatInTz } from "@/lib/utils/datetime";
import { formatPhone } from "@/lib/utils/phone";
import { HISTORY_FILTERS, listHistory, type HistoryFilter } from "@/modules/history/history.service";

export const metadata: Metadata = { title: "Histórico · Cobranças WhatsApp" };

const FILTER_LABELS: Record<HistoryFilter, string> = {
  todos: "Todos",
  enviadas: "Enviadas",
  falhas: "Com falha",
  desconhecido: "Resultado desconhecido",
};

export default async function HistoryPage({ searchParams }: PageProps<"/historico">) {
  await requireUser();
  const sp = await searchParams;
  const filter = HISTORY_FILTERS.find((f) => f === sp.filtro) ?? "todos";
  const page = Number(typeof sp.page === "string" ? sp.page : 1) || 1;
  const { items, total, pages } = await listHistory(filter, page);

  const href = (f: HistoryFilter, p = 1) => {
    const params = new URLSearchParams();
    if (f !== "todos") params.set("filtro", f);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/historico?${qs}` : "/historico";
  };

  return (
    <>
      <PageHeader title="Histórico" description="Resultado de cada disparo, com tentativas e motivo das falhas." />

      <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="Filtrar histórico">
        {HISTORY_FILTERS.map((f) => (
          <Link
            key={f}
            href={href(f)}
            className={cn(buttonVariants({ variant: filter === f ? "secondary" : "ghost", size: "sm" }))}
            aria-current={filter === f ? "page" : undefined}
          >
            {FILTER_LABELS[f]}
          </Link>
        ))}
      </nav>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Mensagem</TableHead>
              <TableHead>Data do envio</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Tentativas</TableHead>
              <TableHead>Motivo da falha</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-10 text-center text-muted-foreground">
                  Nenhum disparo {filter === "todos" ? "ainda" : "com este filtro"}.
                </TableCell>
              </TableRow>
            )}
            {items.map((ch) => {
              const last = ch.attempts[0];
              const unknown = last?.status === "UNKNOWN";
              const message = last?.renderedMessage ?? ch.message;
              return (
                <TableRow key={ch.id} className="align-top">
                  <TableCell>
                    <Link href={`/clientes/${ch.customer.id}`} className="font-medium hover:underline">
                      {ch.customer.name}
                    </Link>
                    <div className="text-xs text-muted-foreground tabular-nums">{formatPhone(ch.customer.phone)}</div>
                  </TableCell>
                  <TableCell className="max-w-64">
                    <Link href={`/cobrancas/${ch.id}`} className="line-clamp-2 whitespace-pre-wrap hover:underline" title={message}>
                      {message}
                    </Link>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {ch.sentAt ? formatInTz(ch.sentAt) : last ? formatInTz(last.attemptedAt) : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col items-start gap-1">
                      <ChargeStatusBadge status={ch.status} />
                      {unknown && ch.status === "FAILED" && <Badge variant="outline">Resultado desconhecido</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{ch._count.attempts}</TableCell>
                  <TableCell className="max-w-64 text-sm text-muted-foreground">
                    {ch.status === "SENT" ? "—" : (ch.lastError ?? last?.errorMessage ?? "—")}
                  </TableCell>
                  <TableCell className="text-right">
                    {ch.status === "FAILED" && <RetryChargeButton chargeId={ch.id} unknownResult={unknown} />}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {total} disparos · página {page} de {pages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={href(filter, page - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                Anterior
              </Link>
            )}
            {page < pages && (
              <Link href={href(filter, page + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                Próxima
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  );
}
