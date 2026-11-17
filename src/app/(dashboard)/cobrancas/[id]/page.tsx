import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CancelChargeButton } from "@/components/charges/cancel-charge-button";
import { ChargeStatusBadge } from "@/components/charges/charge-status-badge";
import { RetryChargeButton } from "@/components/charges/retry-charge-button";
import { PageHeader } from "@/components/layout/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AttemptStatus } from "@/generated/prisma/enums";
import { requireUser } from "@/lib/auth";
import { cn } from "@/lib/utils";
import { formatInTz } from "@/lib/utils/datetime";
import { formatMoney } from "@/lib/utils/money";
import { formatPhone } from "@/lib/utils/phone";
import { getChargeDetail } from "@/modules/charges/charge.service";
import { renderTemplate } from "@/modules/messaging/template";

export const metadata: Metadata = { title: "Cobrança · Cobranças WhatsApp" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ATTEMPT_LABEL: Record<AttemptStatus, string> = {
  STARTED: "Em andamento",
  SUCCESS: "Enviada",
  FAILED: "Falhou",
  UNKNOWN: "Resultado desconhecido",
};

const ATTEMPT_STYLE: Record<AttemptStatus, string> = {
  STARTED: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  SUCCESS: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  FAILED: "bg-red-500/10 text-red-700 dark:text-red-300",
  UNKNOWN: "bg-orange-500/10 text-orange-700 dark:text-orange-300",
};

export default async function ChargeDetailPage({ params }: PageProps<"/cobrancas/[id]">) {
  await requireUser();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const charge = await getChargeDetail(id);
  if (!charge) notFound();

  const lastAttempt = charge.attempts.at(-1);
  const unknown = lastAttempt?.status === "UNKNOWN";
  // Texto exato enviado (última tentativa) ou, se ainda não houve envio, a prévia com os dados atuais.
  const message =
    lastAttempt?.renderedMessage ??
    renderTemplate(charge.message, {
      name: charge.customer.name,
      amount: charge.amount?.toString() ?? null,
      description: charge.description,
      scheduledAt: charge.scheduledAt,
    });

  return (
    <>
      <PageHeader
        title={charge.description}
        description={`Cobrança para ${charge.customer.name}`}
        actions={
          <>
            {charge.status === "PENDING" && (
              <>
                <Link href={`/cobrancas/${charge.id}/editar`} className={buttonVariants({ variant: "outline" })}>
                  Editar
                </Link>
                <CancelChargeButton chargeId={charge.id} label={`${charge.customer.name} — ${charge.description}`} />
              </>
            )}
            {charge.status === "FAILED" && <RetryChargeButton chargeId={charge.id} unknownResult={unknown} />}
            {charge.status !== "PENDING" && charge.status !== "PROCESSING" && (
              <Link href={`/cobrancas/nova?copiarDe=${charge.id}`} className={buttonVariants({ variant: "outline" })}>
                Repetir no próximo mês
              </Link>
            )}
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Resumo</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-[auto_1fr]">
                <dt className="text-muted-foreground">Status</dt>
                <dd>
                  <ChargeStatusBadge status={charge.status} />
                </dd>
                <dt className="text-muted-foreground">Cliente</dt>
                <dd>
                  <Link href={`/clientes/${charge.customer.id}`} className="font-medium hover:underline">
                    {charge.customer.name}
                  </Link>{" "}
                  <span className="text-muted-foreground tabular-nums">{formatPhone(charge.customer.phone)}</span>
                </dd>
                <dt className="text-muted-foreground">Valor</dt>
                <dd className="tabular-nums">{charge.amount ? `R$ ${formatMoney(charge.amount.toString())}` : "—"}</dd>
                <dt className="text-muted-foreground">Agendada para</dt>
                <dd className="tabular-nums">{formatInTz(charge.scheduledAt)}</dd>
                {charge.nextAttemptAt && charge.status === "PENDING" && (
                  <>
                    <dt className="text-muted-foreground">Próxima tentativa</dt>
                    <dd className="tabular-nums">{formatInTz(charge.nextAttemptAt)}</dd>
                  </>
                )}
                {charge.sentAt && (
                  <>
                    <dt className="text-muted-foreground">Enviada em</dt>
                    <dd className="tabular-nums">{formatInTz(charge.sentAt)}</dd>
                  </>
                )}
                {charge.cancelledAt && (
                  <>
                    <dt className="text-muted-foreground">Cancelada em</dt>
                    <dd className="tabular-nums">{formatInTz(charge.cancelledAt)}</dd>
                  </>
                )}
                {charge.lastError && charge.status !== "SENT" && (
                  <>
                    <dt className="text-muted-foreground">Motivo</dt>
                    <dd className="text-destructive">{charge.lastError}</dd>
                  </>
                )}
              </dl>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Tentativas de envio</CardTitle>
              <CardDescription>Cada vez que o sistema tentou mandar esta mensagem.</CardDescription>
            </CardHeader>
            <CardContent>
              {charge.attempts.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {charge.status === "CANCELLED" ? "Cancelada antes do envio." : "Nenhuma tentativa ainda."}
                </p>
              ) : (
                <ol className="space-y-4 border-l pl-4">
                  {charge.attempts.map((a) => (
                    <li key={a.id} className="relative space-y-1 text-sm">
                      <span className="absolute top-1.5 -left-[21px] size-2.5 rounded-full border-2 border-background bg-muted-foreground" />
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">Tentativa {a.attemptNumber}</span>
                        <Badge variant="secondary" className={cn("border-transparent", ATTEMPT_STYLE[a.status])}>
                          {ATTEMPT_LABEL[a.status]}
                        </Badge>
                        <span className="text-muted-foreground tabular-nums">{formatInTz(a.attemptedAt, "dd/MM/yyyy HH:mm:ss")}</span>
                      </div>
                      {a.errorMessage && <p className="text-muted-foreground">{a.errorMessage}</p>}
                      {a.providerMessageId && (
                        <p className="font-mono text-xs text-muted-foreground">ID no WhatsApp: {a.providerMessageId}</p>
                      )}
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>{lastAttempt?.renderedMessage ? "Mensagem enviada" : "Mensagem"}</CardTitle>
            <CardDescription>
              {lastAttempt?.renderedMessage ? "Texto exato da última tentativa." : "Como ficará com os dados atuais."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg bg-emerald-50 p-3 text-sm whitespace-pre-wrap text-emerald-950 shadow-sm dark:bg-emerald-950/40 dark:text-emerald-50">
              {message}
            </div>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
