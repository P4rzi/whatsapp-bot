import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ChargeForm } from "@/components/charges/charge-form";
import { PageHeader } from "@/components/layout/page-header";
import { requireUser } from "@/lib/auth";
import { formatInTz, suggestedSchedule, utcToLocalParts } from "@/lib/utils/datetime";
import { nextOccurrence } from "@/modules/charges/charge.repeat";
import { getCharge } from "@/modules/charges/charge.service";
import { listActiveCustomersForSelect } from "@/modules/customers/customer.service";
import { getDefaultMessageTemplate } from "@/modules/settings/settings.service";

export const metadata: Metadata = { title: "Nova cobrança · Cobranças WhatsApp" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function NewChargePage({ searchParams }: PageProps<"/cobrancas/nova">) {
  await requireUser();
  await connection();
  const { clienteId, copiarDe } = await searchParams;
  const [customers, defaultMessage, source] = await Promise.all([
    listActiveCustomersForSelect(),
    getDefaultMessageTemplate(),
    typeof copiarDe === "string" && UUID_RE.test(copiarDe) ? getCharge(copiarDe) : null,
  ]);

  const { date, time } = suggestedSchedule();
  const options = customers.map((c) => ({ id: c.id, name: c.name, phone: c.phone, hasConsent: !!c.consentAt }));

  // "Repetir": copia a cobrança para o próximo mês (mesmo dia e horário), já preenchida.
  let initialValues;
  let description = "A mensagem será enviada automaticamente na data e horário escolhidos.";
  if (source) {
    const next = utcToLocalParts(nextOccurrence(source.scheduledAt));
    initialValues = {
      customerId: options.some((o) => o.id === source.customerId) ? source.customerId : "",
      description: source.description,
      amount: source.amount ? source.amount.toFixed(2).replace(".", ",") : "",
      date: next.date,
      time: next.time,
      message: source.message,
    };
    description = `Cópia da cobrança de ${formatInTz(source.scheduledAt, "dd/MM/yyyy")} para ${source.customer.name}. Confira e ajuste antes de agendar.`;
  }

  return (
    <>
      <PageHeader title={source ? "Repetir cobrança" : "Nova cobrança"} description={description} />
      {customers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nenhum cliente ativo.{" "}
          <Link href="/clientes/novo" className="font-medium text-foreground underline">
            Cadastre um cliente
          </Link>{" "}
          primeiro.
        </p>
      ) : (
        <ChargeForm
          customers={options}
          defaultCustomerId={typeof clienteId === "string" && customers.some((c) => c.id === clienteId) ? clienteId : undefined}
          defaultMessage={defaultMessage}
          defaultDate={date}
          defaultTime={time}
          initialValues={initialValues}
        />
      )}
    </>
  );
}
