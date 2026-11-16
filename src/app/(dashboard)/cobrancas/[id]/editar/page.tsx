import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ChargeForm } from "@/components/charges/charge-form";
import { PageHeader } from "@/components/layout/page-header";
import { requireUser } from "@/lib/auth";
import { utcToLocalParts } from "@/lib/utils/datetime";
import { getCharge } from "@/modules/charges/charge.service";
import { listActiveCustomersForSelect } from "@/modules/customers/customer.service";

export const metadata: Metadata = { title: "Editar cobrança · Cobranças WhatsApp" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function EditChargePage({ params }: PageProps<"/cobrancas/[id]/editar">) {
  await requireUser();
  await connection();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const [charge, customers] = await Promise.all([getCharge(id), listActiveCustomersForSelect()]);
  if (!charge) notFound();

  if (charge.status !== "PENDING") {
    return (
      <>
        <PageHeader title="Editar cobrança" />
        <p className="text-sm text-muted-foreground">
          Esta cobrança não está mais agendada e não pode ser editada.{" "}
          <Link href="/cobrancas" className="font-medium text-foreground underline">
            Voltar para cobranças
          </Link>
        </p>
      </>
    );
  }

  // Se o cliente atual ficou inativo, ainda aparece na lista para não sumir do formulário.
  const options = customers.map((c) => ({ id: c.id, name: c.name, phone: c.phone, hasConsent: !!c.consentAt }));
  const { date, time } = utcToLocalParts(charge.scheduledAt);

  return (
    <>
      <PageHeader title="Editar cobrança" description={`Cliente: ${charge.customer.name}`} />
      <ChargeForm
        customers={options}
        defaultMessage={charge.message}
        defaultDate={date}
        defaultTime={time}
        chargeId={charge.id}
        initialValues={{
          customerId: options.some((o) => o.id === charge.customerId) ? charge.customerId : "",
          description: charge.description,
          amount: charge.amount ? charge.amount.toFixed(2).replace(".", ",") : "",
          date,
          time,
          message: charge.message,
        }}
      />
    </>
  );
}
