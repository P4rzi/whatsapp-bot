import { Badge } from "@/components/ui/badge";
import type { WhatsAppStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

export const WHATSAPP_STATUS_LABEL: Record<WhatsAppStatus, string> = {
  DISCONNECTED: "Desconectado",
  CONNECTING: "Conectando",
  QR_CODE_REQUIRED: "Aguardando QR Code",
  CONNECTED: "Conectado",
  RECONNECTING: "Reconectando",
  ERROR: "Erro",
};

const STYLES: Record<WhatsAppStatus, string> = {
  DISCONNECTED: "bg-muted text-muted-foreground",
  CONNECTING: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  QR_CODE_REQUIRED: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  CONNECTED: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  RECONNECTING: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  ERROR: "bg-red-500/10 text-red-700 dark:text-red-300",
};

export function WhatsAppStatusBadge({ status }: { status: WhatsAppStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", STYLES[status])}>
      {WHATSAPP_STATUS_LABEL[status]}
    </Badge>
  );
}
