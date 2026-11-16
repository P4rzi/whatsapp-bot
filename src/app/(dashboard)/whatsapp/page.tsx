import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";
import { PageHeader } from "@/components/layout/page-header";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "WhatsApp · Cobranças WhatsApp" };

export default async function WhatsappPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="WhatsApp" description="Conexão do número que envia as cobranças." />
      <ComingSoon>A conexão por QR Code chega na Etapa 3.</ComingSoon>
    </>
  );
}
