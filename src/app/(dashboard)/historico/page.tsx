import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";
import { PageHeader } from "@/components/layout/page-header";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Histórico · Cobranças WhatsApp" };

export default async function HistoricoPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Histórico" description="Histórico de disparos." />
      <ComingSoon>O histórico de envios (tentativas, falhas e motivos) chega na Etapa 4, junto com o serviço de envio.</ComingSoon>
    </>
  );
}
