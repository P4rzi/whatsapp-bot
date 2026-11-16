import type { Metadata } from "next";
import { CustomerForm } from "@/components/customers/customer-form";
import { PageHeader } from "@/components/layout/page-header";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Novo cliente · Cobranças WhatsApp" };

export default async function NewCustomerPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Novo cliente" />
      <CustomerForm />
    </>
  );
}
