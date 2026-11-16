import type { Metadata } from "next";
import { connection } from "next/server";
import { PageHeader } from "@/components/layout/page-header";
import { WhatsAppPanel } from "@/components/whatsapp/whatsapp-panel";
import { requireUser } from "@/lib/auth";
import { getWhatsAppStatusView } from "@/modules/whatsapp/whatsapp.service";

export const metadata: Metadata = { title: "WhatsApp · Cobranças WhatsApp" };

export default async function WhatsappPage() {
  await requireUser();
  await connection();
  const initial = await getWhatsAppStatusView();
  return (
    <>
      <PageHeader title="WhatsApp" description="Conexão do número que envia as cobranças." />
      <WhatsAppPanel initial={initial} />
    </>
  );
}
