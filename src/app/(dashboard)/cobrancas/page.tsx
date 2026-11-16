import type { Metadata } from "next";
import Link from "next/link";
import { Plus } from "lucide-react";
import { CancelChargeButton } from "@/components/charges/cancel-charge-button";
import { CHARGE_STATUS_LABEL, ChargeStatusBadge } from "@/components/charges/charge-status-badge";
import { RetryChargeButton } from "@/components/charges/retry-charge-button";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChargeStatus } from "@/generated/prisma/enums";
import { requireUser } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { formatInTz } from "@/lib/utils/datetime";
import { formatMoney } from "@/lib/utils/money";
import { formatPhone } from "@/lib/utils/phone";
import { listCharges } from "@/modules/charges/charge.service";

export const metadata: Metadata = { title: "Cobranças · Cobranças WhatsApp" };

const FILTERS: { value?: ChargeStatus; label: string }[] = [
  { label: "Todas" },
  ...Object.values(ChargeStatus).map((s) => ({ value: s, label: CHARGE_STATUS_LABEL[s] })),
];

export default async function ChargesPage({ searchParams }: PageProps<"/cobrancas">) {
  await requireUser();
  const sp = await searchParams;
  const status = Object.values(ChargeStatus).find((s) => s === sp.status);
  const page = Number(typeof sp.page === "string" ? sp.page : 1) || 1;
  const { items, total, pages } = await listCharges({ status, page });

  const href = (p: { status?: string; page?: number }) => {
    const params = new URLSearchParams();
    if (p.status) params.set("status", p.status);
    if (p.page && p.page > 1) params.set("page", String(p.page));
    const qs = params.toString();
    return qs ? `/cobrancas?${qs}` : "/cobrancas";
  };

  return (
    <>
      <PageHeader
        title="Cobranças"
        description="Mensagens agendadas e seus resultados."
        actions={
          <Link href="/cobrancas/nova" className={buttonVariants()}>
            <Plus />
            Nova cobrança
          </Link>
        }
      />

      <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="Filtrar por status">
        {FILTERS.map((f) => (
          <Link
            key={f.label}
            href={href({ status: f.value })}
            className={cn(buttonVariants({ variant: status === f.value ? "secondary" : "ghost", size: "sm" }))}
            aria-current={status === f.value ? "page" : undefined}
          >
            {f.label}
          </Link>
        ))}
      </nav>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Descrição</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              <TableHead>Envio</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-10 text-center text-muted-foreground">
                  Nenhuma cobrança {status ? "com este status" : "cadastrada ainda"}.
                </TableCell>
              </TableRow>
            )}
            {items.map((ch) => (
              <TableRow key={ch.id}>
                <TableCell>
                  <Link href={`/clientes/${ch.customer.id}`} className="font-medium hover:underline">
                    {ch.customer.name}
                  </Link>
                  <div className="text-xs text-muted-foreground tabular-nums">{formatPhone(ch.customer.phone)}</div>
                </TableCell>
                <TableCell className="max-w-56">
                  <div className="truncate">{ch.description}</div>
                  {ch.status === "FAILED" && ch.lastError && (
                    <div className="truncate text-xs text-destructive" title={ch.lastError}>
                      {ch.lastError}
                    </div>
                  )}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {ch.amount ? `R$ ${formatMoney(ch.amount.toString())}` : "—"}
                </TableCell>
                <TableCell className="tabular-nums">
                  {formatInTz(ch.sentAt ?? ch.scheduledAt)}
                  {ch.sentAt && <div className="text-xs text-muted-foreground">enviada</div>}
                </TableCell>
                <TableCell>
                  <ChargeStatusBadge status={ch.status} />
                </TableCell>
                <TableCell className="text-right">
                  {ch.status === "PENDING" && (
                    <CancelChargeButton
                      chargeId={ch.id}
                      label={`${ch.customer.name} — ${ch.description}, ${formatInTz(ch.scheduledAt)}`}
                    />
                  )}
                  {ch.status === "FAILED" && (
                    <RetryChargeButton
                      chargeId={ch.id}
                      unknownResult={!!ch.lastError?.includes("Resultado desconhecido")}
                    />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {pages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
          <span>
            {total} cobranças · página {page} de {pages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={href({ status, page: page - 1 })} className={buttonVariants({ variant: "outline", size: "sm" })}>
                Anterior
              </Link>
            )}
            {page < pages && (
              <Link href={href({ status, page: page + 1 })} className={buttonVariants({ variant: "outline", size: "sm" })}>
                Próxima
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  );
}
