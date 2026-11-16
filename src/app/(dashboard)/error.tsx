"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

// Erro inesperado dentro do painel: mostra uma mensagem amigável sem derrubar a navegação.
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <AlertTriangle className="size-8 text-amber-500" />
      <h1 className="text-lg font-semibold">Algo deu errado ao carregar esta página</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Tente novamente. Se o problema continuar, pode ser uma instabilidade momentânea do servidor ou do banco de
        dados.
        {error.digest && <span className="mt-1 block text-xs">Código: {error.digest}</span>}
      </p>
      <Button onClick={reset}>
        <RotateCcw />
        Tentar novamente
      </Button>
    </div>
  );
}
