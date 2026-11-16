import type { Metadata } from "next";
import { PageHeader } from "@/components/layout/page-header";
import { PasswordForm } from "@/components/settings/password-form";
import { TemplateForm } from "@/components/settings/template-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth";
import { getDefaultMessageTemplate } from "@/modules/settings/settings.service";

export const metadata: Metadata = { title: "Configurações · Cobranças WhatsApp" };

export default async function SettingsPage() {
  const user = await requireUser();
  const template = await getDefaultMessageTemplate();

  return (
    <>
      <PageHeader title="Configurações" description="Mensagem padrão e acesso ao painel." />
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Mensagem padrão das cobranças</CardTitle>
            <CardDescription>Texto inicial sugerido ao criar uma cobrança.</CardDescription>
          </CardHeader>
          <CardContent>
            <TemplateForm initial={template} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Senha</CardTitle>
            <CardDescription>Conta: {user.email}</CardDescription>
          </CardHeader>
          <CardContent>
            <PasswordForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dados e privacidade (LGPD)</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-muted-foreground">
            <p>Mensagens só são enviadas a clientes com autorização registrada e que não pediram descadastro.</p>
            <p>O histórico de tentativas de envio é apagado automaticamente após 6 meses.</p>
            <p>Ao excluir um cliente, todas as cobranças e o histórico dele são apagados definitivamente.</p>
            <p>Os registros do sistema não guardam senhas, credenciais do WhatsApp nem telefones completos.</p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
