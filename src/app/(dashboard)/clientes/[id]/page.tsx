import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus } from "lucide-react";
import { ChargeStatusBadge } from "@/components/charges/charge-status-badge";
import { CustomerForm } from "@/components/customers/customer-form";
import { DeleteCustomerButton } from "@/components/customers/delete-customer-button";
import { PageHeader } from "@/components/layout/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth";
import { formatInTz } from "@/lib/utils/datetime";
import { formatMoney } from "@/lib/utils/money";
import { formatPhone } from "@/lib/utils/phone";
import { getCustomer } from "@/modules/customers/customer.service";

export const metadata: Metadata = { title: "Cliente · Cobranças WhatsApp" };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CustomerPage({ params }: PageProps<"/clientes/[id]">) {
  await requireUser();
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const customer = await getCustomer(id);
  if (!customer) notFound();

  return (
    <>
      <PageHeader
        title={customer.name}
        description={formatPhone(customer.phone)}
        actions={
          <>
            <Link href={`/cobrancas/nova?clienteId=${customer.id}`} className={buttonVariants({ variant: "outline" })}>
              <Plus />
              Nova cobrança
            </Link>
            <DeleteCustomerButton customerId={customer.id} name={customer.name} />
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Dados do cliente</CardTitle>
          </CardHeader>
          <CardContent>
            <CustomerForm
              customerId={customer.id}
              defaultValues={{
                name: customer.name,
                phone: formatPhone(customer.phone),
                notes: customer.notes ?? "",
                isActive: customer.isActive,
                consent: !!customer.consentAt,
                consentSource: customer.consentSource ?? "",
                optedOut: !!customer.optedOutAt,
              }}
            />
            {customer.consentAt && (
              <p className="mt-4 text-xs text-muted-foreground">
                Autorização registrada em {formatInTz(customer.consentAt)} ({customer.consentSource}).
              </p>
            )}
            {customer.optedOutAt && (
              <p className="mt-1 text-xs text-muted-foreground">
                Descadastro registrado em {formatInTz(customer.optedOutAt)}.
              </p>
            )}
          </CardContent>
        </Card>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle>Cobranças</CardTitle>
          </CardHeader>
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Descrição</TableHead>
                  <TableHead>Envio</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="pr-4">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {customer.charges.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                      Nenhuma cobrança.
                    </TableCell>
                  </TableRow>
                )}
                {customer.charges.map((ch) => (
                  <TableRow key={ch.id}>
                    <TableCell className="max-w-48 truncate pl-4">{ch.description}</TableCell>
                    <TableCell className="tabular-nums">{formatInTz(ch.scheduledAt)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {ch.amount ? `R$ ${formatMoney(ch.amount.toString())}` : "—"}
                    </TableCell>
                    <TableCell className="pr-4">
                      <ChargeStatusBadge status={ch.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
