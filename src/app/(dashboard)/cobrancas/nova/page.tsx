import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";
import { ChargeForm } from "@/components/charges/charge-form";
import { PageHeader } from "@/components/layout/page-header";
import { requireUser } from "@/lib/auth";
import { suggestedSchedule } from "@/lib/utils/datetime";
import { listActiveCustomersForSelect } from "@/modules/customers/customer.service";
import { getDefaultMessageTemplate } from "@/modules/settings/settings.service";

export const metadata: Metadata = { title: "Nova cobrança · Cobranças WhatsApp" };

export default async function NewChargePage({ searchParams }: PageProps<"/cobrancas/nova">) {
  await requireUser();
  await connection();
  const { clienteId } = await searchParams;
  const [customers, defaultMessage] = await Promise.all([listActiveCustomersForSelect(), getDefaultMessageTemplate()]);

  const { date, time } = suggestedSchedule();

  return (
    <>
      <PageHeader title="Nova cobrança" description="A mensagem será enviada automaticamente na data e horário escolhidos." />
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
          customers={customers.map((c) => ({ id: c.id, name: c.name, phone: c.phone, hasConsent: !!c.consentAt }))}
          defaultCustomerId={typeof clienteId === "string" && customers.some((c) => c.id === clienteId) ? clienteId : undefined}
          defaultMessage={defaultMessage}
          defaultDate={date}
          defaultTime={time}
        />
      )}
    </>
  );
}
