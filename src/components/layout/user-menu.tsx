import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { logoutAction } from "@/modules/auth/auth.actions";

// Lê a sessão: precisa ficar dentro de <Suspense>.
export async function UserMenu() {
  const user = await requireUser();
  return (
    <div className="flex items-center gap-3">
      <div className="hidden text-right text-sm leading-tight sm:block">
        <div className="font-medium">{user.name}</div>
        <div className="text-xs text-muted-foreground">{user.email}</div>
      </div>
      <form action={logoutAction}>
        <Button type="submit" variant="ghost" size="icon" aria-label="Sair" title="Sair">
          <LogOut />
        </Button>
      </form>
    </div>
  );
}
