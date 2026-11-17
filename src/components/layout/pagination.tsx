import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

/** Paginação simples por links (funciona sem JavaScript). */
export function Pagination({
  page,
  pages,
  total,
  noun,
  href,
}: {
  page: number;
  pages: number;
  total: number;
  /** Ex.: "clientes" */
  noun: string;
  href: (page: number) => string;
}) {
  if (pages <= 1) return null;
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
      <span>
        {total} {noun} · página {page} de {pages}
      </span>
      <div className="flex gap-2">
        {page > 1 && (
          <Link href={href(page - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Anterior
          </Link>
        )}
        {page < pages && (
          <Link href={href(page + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Próxima
          </Link>
        )}
      </div>
    </div>
  );
}
