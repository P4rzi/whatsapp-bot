import { Badge } from "@/components/ui/badge";

export function CustomerStatus({ isActive, consent, optedOut }: { isActive: boolean; consent: boolean; optedOut: boolean }) {
  if (optedOut) return <Badge variant="destructive">Descadastrado</Badge>;
  if (!isActive) return <Badge variant="secondary">Inativo</Badge>;
  if (!consent) return <Badge variant="outline">Sem autorização</Badge>;
  return (
    <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">
      Pode receber
    </Badge>
  );
}
