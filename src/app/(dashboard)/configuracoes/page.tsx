import type { Metadata } from "next";
import { ComingSoon } from "@/components/layout/coming-soon";
import { PageHeader } from "@/components/layout/page-header";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Configurações · Cobranças WhatsApp" };

export default async function ConfiguracoesPage() {
  await requireUser();
  return (
    <>
      <PageHeader title="Configurações" description="Ajustes gerais do sistema." />
      <ComingSoon>Troca de senha e mensagem padrão chegam em uma próxima etapa.</ComingSoon>
    </>
  );
}
