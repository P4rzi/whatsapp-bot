"use client";

import { AlertTriangle, Loader2, Plug, RefreshCw, Unplug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatInTz } from "@/lib/utils/datetime";
import { formatPhone } from "@/lib/utils/phone";
import { whatsappCommandAction } from "@/modules/whatsapp/whatsapp.actions";
import type { WhatsAppStatusView } from "@/modules/whatsapp/whatsapp.service";
import { WhatsAppStatusBadge } from "./whatsapp-status-badge";

const FAST_POLL_MS = 3_000;
const SLOW_POLL_MS = 15_000;

export function WhatsAppPanel({ initial }: { initial: WhatsAppStatusView }) {
  const router = useRouter();
  const [view, setView] = useState(initial);
  const [pending, startTransition] = useTransition();

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/whatsapp/status", { cache: "no-store" });
      if (res.status === 401) return router.push("/login");
      if (res.ok) setView(await res.json());
    } catch {
      // rede instável: tenta de novo no próximo ciclo
    }
  }, [router]);

  // Polling: rápido enquanto algo está acontecendo, lento quando estável.
  const busy = view.status !== "CONNECTED" && view.status !== "DISCONNECTED" && view.status !== "ERROR";
  const interval = busy || view.pendingCommand ? FAST_POLL_MS : SLOW_POLL_MS;
  useEffect(() => {
    const id = setInterval(refresh, interval);
    return () => clearInterval(id);
  }, [refresh, interval]);

  function send(kind: "connect" | "disconnect" | "restart") {
    startTransition(async () => {
      const result = await whatsappCommandAction(kind);
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
      await refresh();
    });
  }

  const canConnect = view.status === "DISCONNECTED" || view.status === "ERROR";
  const canDisconnect = view.status !== "DISCONNECTED";
  const canRestart = view.status === "CONNECTED" || view.status === "ERROR" || view.status === "RECONNECTING";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <div className="space-y-6">
        {!view.workerOnline && (
          <div className="flex items-start gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-900 dark:text-amber-100">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              O serviço de envio (worker) não está respondendo. Os pedidos de conexão só são atendidos quando ele estiver
              rodando.
            </div>
          </div>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Conexão</CardTitle>
            <CardDescription>Número que envia as mensagens de cobrança.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <WhatsAppStatusBadge status={view.status} />
              {view.pendingCommand && (
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> processando pedido…
                </span>
              )}
            </div>

            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-muted-foreground">Número conectado</dt>
              <dd className="tabular-nums">{view.phoneNumber ? formatPhone(view.phoneNumber) : "—"}</dd>
              <dt className="text-muted-foreground">Última conexão</dt>
              <dd className="tabular-nums">{view.lastConnectedAt ? formatInTz(new Date(view.lastConnectedAt)) : "—"}</dd>
              <dt className="text-muted-foreground">Última desconexão</dt>
              <dd className="tabular-nums">
                {view.lastDisconnectedAt ? formatInTz(new Date(view.lastDisconnectedAt)) : "—"}
              </dd>
            </dl>

            {view.lastError && (
              <p className="rounded-lg bg-muted p-3 text-sm" role="status">
                {view.lastError}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              {canConnect && (
                <Button onClick={() => send("connect")} disabled={pending || !!view.pendingCommand}>
                  {pending ? <Loader2 className="animate-spin" /> : <Plug />}
                  Conectar
                </Button>
              )}
              {canRestart && (
                <Button variant="outline" onClick={() => send("restart")} disabled={pending || !!view.pendingCommand}>
                  <RefreshCw />
                  Reconectar
                </Button>
              )}
              {canDisconnect && (
                <AlertDialog>
                  <AlertDialogTrigger
                    render={<Button variant="destructive" disabled={pending || !!view.pendingCommand} />}
                  >
                    <Unplug />
                    Desconectar
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Desconectar o WhatsApp?</AlertDialogTitle>
                      <AlertDialogDescription>
                        O aparelho será removido dos dispositivos conectados e as cobranças agendadas não serão enviadas
                        até você conectar de novo (lendo um novo QR Code).
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Voltar</AlertDialogCancel>
                      <AlertDialogAction variant="destructive" onClick={() => send("disconnect")}>
                        Desconectar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          </CardContent>
        </Card>

        <p className="text-xs text-muted-foreground">
          Esta integração usa o WhatsApp Web de forma não oficial. A conexão pode ficar instável e a entrega das mensagens
          não é garantida. Envie apenas para clientes que autorizaram receber mensagens.
        </p>
      </div>

      <Card className="h-fit">
        <CardHeader>
          <CardTitle>QR Code</CardTitle>
          <CardDescription>
            No celular: WhatsApp → Configurações → Dispositivos conectados → Conectar dispositivo.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex min-h-72 items-center justify-center">
          {view.qrDataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- imagem gerada (data URL), não precisa de otimização
            <img src={view.qrDataUrl} alt="QR Code para conectar o WhatsApp" className="size-64 rounded-lg bg-white p-2" />
          ) : view.status === "CONNECTED" ? (
            <p className="text-center text-sm text-muted-foreground">Conectado. Não é preciso ler o QR Code.</p>
          ) : view.status === "CONNECTING" || view.status === "RECONNECTING" || view.pendingCommand ? (
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          ) : (
            <p className="text-center text-sm text-muted-foreground">Clique em Conectar para gerar o QR Code.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
