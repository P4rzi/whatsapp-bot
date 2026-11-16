import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { CustomerStatus } from "@/components/customers/customer-status";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { requireUser } from "@/lib/auth";
import { formatPhone } from "@/lib/utils/phone";
import { listCustomers } from "@/modules/customers/customer.service";

export const metadata: Metadata = { title: "Clientes · Cobranças WhatsApp" };

export default async function CustomersPage({ searchParams }: PageProps<"/clientes">) {
  await requireUser();
  const { q } = await searchParams;
  const search = typeof q === "string" ? q.slice(0, 100) : "";
  const customers = await listCustomers(search);

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Quem recebe as mensagens de cobrança."
        actions={
          <Link href="/clientes/novo" className={buttonVariants()}>
            <Plus />
            Novo cliente
          </Link>
        }
      />

      <form className="mb-4 flex max-w-md gap-2" role="search">
        <Input name="q" defaultValue={search} placeholder="Buscar por nome ou telefone" aria-label="Buscar clientes" />
        <Button type="submit" variant="outline" size="icon" aria-label="Buscar">
          <Search />
        </Button>
      </form>

      <Card className="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>Situação</TableHead>
              <TableHead className="text-right">Cobranças agendadas</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {customers.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="py-10 text-center text-muted-foreground">
                  {search ? "Nenhum cliente encontrado." : "Nenhum cliente cadastrado ainda."}
                </TableCell>
              </TableRow>
            )}
            {customers.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">
                  <Link href={`/clientes/${c.id}`} className="hover:underline">
                    {c.name}
                  </Link>
                </TableCell>
                <TableCell className="tabular-nums">{formatPhone(c.phone)}</TableCell>
                <TableCell>
                  <CustomerStatus isActive={c.isActive} consent={!!c.consentAt} optedOut={!!c.optedOutAt} />
                </TableCell>
                <TableCell className="text-right tabular-nums">{c._count.charges}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
