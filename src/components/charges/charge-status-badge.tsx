import { Badge } from "@/components/ui/badge";
import type { ChargeStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";

export const CHARGE_STATUS_LABEL: Record<ChargeStatus, string> = {
  PENDING: "Agendada",
  PROCESSING: "Enviando",
  SENT: "Enviada",
  FAILED: "Falhou",
  CANCELLED: "Cancelada",
};

const STYLES: Record<ChargeStatus, string> = {
  PENDING: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  PROCESSING: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  SENT: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  FAILED: "bg-red-500/10 text-red-700 dark:text-red-300",
  CANCELLED: "bg-muted text-muted-foreground",
};

export function ChargeStatusBadge({ status }: { status: ChargeStatus }) {
  return (
    <Badge variant="secondary" className={cn("border-transparent", STYLES[status])}>
      {CHARGE_STATUS_LABEL[status]}
    </Badge>
  );
}
