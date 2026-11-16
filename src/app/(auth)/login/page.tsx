import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LoginForm } from "@/components/auth/login-form";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Entrar · Cobranças WhatsApp" };

export default async function LoginPage() {
  // Sessão realmente válida (não só o token): vai direto para o painel.
  if (await getCurrentUser()) redirect("/dashboard");

  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="items-center text-center">
          <div className="mx-auto mb-2 flex size-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <MessageCircle className="size-5" />
          </div>
          <CardTitle className="text-lg">Cobranças WhatsApp</CardTitle>
          <CardDescription>Entre com seu e-mail e senha</CardDescription>
        </CardHeader>
        <CardContent>
          <LoginForm />
        </CardContent>
      </Card>
    </main>
  );
}
