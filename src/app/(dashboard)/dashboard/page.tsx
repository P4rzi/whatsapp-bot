import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { AlertTriangle, CheckCircle2, Clock, Inbox, Users, XCircle, type LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { WhatsAppStatusBadge } from "@/components/whatsapp/whatsapp-status-badge";
import { requireUser } from "@/lib/auth";
import { formatInTz } from "@/lib/utils/datetime";
import { formatMoney } from "@/lib/utils/money";
import { formatPhone } from "@/lib/utils/phone";
import { getDashboardData } from "@/modules/dashboard/dashboard.service";

export const metadata: Metadata = { title: "Dashboard · Cobranças WhatsApp" };

export default async function DashboardPage() {
  await requireUser();
  await connection();
  const data = await getDashboardData();
  const workerOk = data.workerOk;
  const whatsappOk = data.whatsapp.status === "CONNECTED";

  return (
    <>
      <PageHeader title="Dashboard" description="Visão geral das cobranças." />

      {(!workerOk || !whatsappOk) && data.pending > 0 && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div>
            Há cobranças agendadas, mas {!whatsappOk ? "o WhatsApp não está conectado" : "o serviço de envio não está respondendo"}.
            As mensagens só saem quando os dois estiverem funcionando.
          </div>
        </div>
      )}

      {data.inbound.total > 0 && (
        <Link
          href={data.inbound.optOut > 0 ? "/respostas?filtro=parar" : "/respostas"}
          className="mb-6 flex items-start gap-3 rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-sm text-sky-900 hover:bg-sky-500/15 dark:text-sky-100"
        >
          <Inbox className="mt-0.5 size-4 shrink-0" />
          <div>
            {data.inbound.total === 1 ? "1 resposta nova de cliente" : `${data.inbound.total} respostas novas de clientes`}
            {data.inbound.optOut > 0 &&
              ` — ${data.inbound.optOut === 1 ? "1 pede" : `${data.inbound.optOut} pedem`} para parar de receber mensagens`}
            . Ver respostas →
          </div>
        </Link>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={Users} label="Clientes cadastrados" value={data.customers} href="/clientes" />
        <Stat icon={Clock} label="Cobranças pendentes" value={data.pending} href="/cobrancas?status=PENDING" />
        <Stat icon={CheckCircle2} label="Enviadas" value={data.sent} href="/cobrancas?status=SENT" />
        <Stat icon={XCircle} label="Com falha" value={data.failed} href="/cobrancas?status=FAILED" />
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Próximos disparos</CardTitle>
            <CardDescription>As 5 próximas mensagens agendadas.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.upcoming.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nenhuma cobrança agendada.</p>
            ) : (
              <ul className="divide-y">
                {data.upcoming.map((ch) => (
                  <li key={ch.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                    <div className="min-w-0">
                      <Link href={`/clientes/${ch.customer.id}`} className="font-medium hover:underline">
                        {ch.customer.name}
                      </Link>
                      <div className="truncate text-muted-foreground">
                        {ch.description}
                        {ch.amount && ` · R$ ${formatMoney(ch.amount.toString())}`}
                      </div>
                    </div>
                    <span className="shrink-0 tabular-nums">{formatInTz(ch.scheduledAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>WhatsApp</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <WhatsAppStatusBadge status={data.whatsapp.status} />
            {data.whatsapp.phoneNumber && <div className="tabular-nums">{formatPhone(data.whatsapp.phoneNumber)}</div>}
            {data.whatsapp.lastConnectedAt && (
              <div className="text-muted-foreground">Última conexão: {formatInTz(data.whatsapp.lastConnectedAt)}</div>
            )}
            <div className="text-muted-foreground">
              Serviço de envio: {workerOk ? "funcionando" : "sem resposta"}
            </div>
            <Link href="/whatsapp" className={buttonVariants({ variant: "outline", size: "sm" })}>
              Gerenciar conexão
            </Link>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function Stat({ icon: Icon, label, value, href }: { icon: LucideIcon; label: string; value: number; href: string }) {
  return (
    <Link href={href} className="rounded-xl transition-shadow hover:shadow-md focus-visible:outline-2">
      <Card>
        <CardContent className="flex items-center justify-between">
          <div>
            <div className="text-sm text-muted-foreground">{label}</div>
            <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
          </div>
          <Icon className="size-5 text-muted-foreground" />
        </CardContent>
      </Card>
    </Link>
  );
}
