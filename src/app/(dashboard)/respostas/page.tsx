import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { Info } from "lucide-react";
import { InboundText, IntentBadge } from "@/components/inbound/inbound-badges";
import { MarkAllHandledButton, MarkHandledButton, OptOutButton } from "@/components/inbound/inbound-actions";
import { PageHeader } from "@/components/layout/page-header";
import { Pagination } from "@/components/layout/pagination";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { formatInTz } from "@/lib/utils/datetime";
import { formatPhone } from "@/lib/utils/phone";
import { countUnhandledInbound, INBOUND_FILTERS, listInbound, type InboundFilter } from "@/modules/inbound/inbound.service";

export const metadata: Metadata = { title: "Respostas · Cobranças WhatsApp" };

const FILTER_LABELS: Record<InboundFilter, string> = {
  "nao-vistas": "Não vistas",
  parar: "Pediram para parar",
  pagamento: "Dizem que pagaram",
  todas: "Todas",
};

export default async function InboundPage({ searchParams }: PageProps<"/respostas">) {
  await requireUser();
  await connection();
  const sp = await searchParams;
  const filter = INBOUND_FILTERS.find((f) => f === sp.filtro) ?? "nao-vistas";
  const page = Number(typeof sp.page === "string" ? sp.page : 1) || 1;
  const [{ items, total, pages }, unhandled] = await Promise.all([listInbound(filter, page), countUnhandledInbound()]);

  const href = (f: InboundFilter, p = 1) => {
    const params = new URLSearchParams();
    if (f !== "nao-vistas") params.set("filtro", f);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/respostas?${qs}` : "/respostas";
  };

  return (
    <>
      <PageHeader
        title="Respostas"
        description="Mensagens que os clientes mandaram para o WhatsApp de cobranças."
        actions={unhandled.total > 0 ? <MarkAllHandledButton /> : undefined}
      />

      <div className="mb-4 flex items-start gap-3 rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
        <Info className="mt-0.5 size-4 shrink-0" />
        <p>
          O sistema não responde ninguém sozinho: responda pelo próprio WhatsApp. Só ficam registradas mensagens de
          clientes cadastrados, a partir do momento em que o WhatsApp está conectado. Pedidos para parar não descadastram
          automaticamente — use o botão “Descadastrar” se for o caso.
        </p>
      </div>

      <nav className="mb-4 flex flex-wrap gap-1.5" aria-label="Filtrar respostas">
        {INBOUND_FILTERS.map((f) => (
          <Link
            key={f}
            href={href(f)}
            className={cn(buttonVariants({ variant: filter === f ? "secondary" : "ghost", size: "sm" }))}
            aria-current={filter === f ? "page" : undefined}
          >
            {FILTER_LABELS[f]}
            {f === "nao-vistas" && unhandled.total > 0 && <Badge className="ml-1">{unhandled.total}</Badge>}
            {f === "parar" && unhandled.optOut > 0 && (
              <Badge variant="destructive" className="ml-1">
                {unhandled.optOut}
              </Badge>
            )}
          </Link>
        ))}
      </nav>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cliente</TableHead>
              <TableHead>Mensagem</TableHead>
              <TableHead>Recebida</TableHead>
              <TableHead />
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  {filter === "nao-vistas" ? "Nenhuma resposta nova." : "Nenhuma resposta com este filtro."}
                </TableCell>
              </TableRow>
            )}
            {items.map((m) => (
              <TableRow key={m.id} className={cn("align-top", m.handledAt && "text-muted-foreground")}>
                <TableCell>
                  <Link href={`/clientes/${m.customer.id}`} className="font-medium hover:underline">
                    {m.customer.name}
                  </Link>
                  <div className="text-xs text-muted-foreground tabular-nums">{formatPhone(m.customer.phone)}</div>
                  {m.customer.optedOutAt && (
                    <Badge variant="outline" className="mt-1">
                      Descadastrado
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="max-w-md">
                  <div className="flex flex-col items-start gap-1.5">
                    <IntentBadge intent={m.intent} />
                    <InboundText kind={m.kind} text={m.text} />
                  </div>
                </TableCell>
                <TableCell className="whitespace-nowrap tabular-nums">
                  {formatInTz(m.receivedAt)}
                  {m.handledAt && <div className="text-xs">Vista</div>}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap justify-end gap-1">
                    {m.intent === "PAYMENT_CLAIM" && (
                      <Link
                        href={`/cobrancas?q=${encodeURIComponent(m.customer.name)}`}
                        className={buttonVariants({ variant: "ghost", size: "sm" })}
                      >
                        Ver cobranças
                      </Link>
                    )}
                    {m.intent === "OPT_OUT" && !m.customer.optedOutAt && (
                      <OptOutButton customerId={m.customer.id} name={m.customer.name} />
                    )}
                    {!m.handledAt && <MarkHandledButton id={m.id} />}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Pagination page={page} pages={pages} total={total} noun="respostas" href={(p) => href(filter, p)} />
    </>
  );
}
