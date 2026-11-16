import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 p-6 text-center">
      <div className="text-5xl font-semibold text-muted-foreground">404</div>
      <h1 className="text-lg font-semibold">Página não encontrada</h1>
      <p className="max-w-sm text-sm text-muted-foreground">O endereço pode estar errado ou o item foi excluído.</p>
      <Link href="/dashboard" className={buttonVariants()}>
        Ir para o painel
      </Link>
    </main>
  );
}
