import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

// Checagem rápida de sessão antes de renderizar. A checagem completa (usuário existe,
// senha não mudou) acontece em requireUser(), em cada página e ação.

const PUBLIC_PATHS = ["/login", "/api/health"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const session = await verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value);

  // Rotas públicas passam direto. Quem já está logado e abre /login é redirecionado
  // pela própria página de login, depois da checagem completa (evita loop de redirecionamento
  // quando o token é válido mas a sessão foi invalidada, ex.: senha trocada).
  if (isPublic) return NextResponse.next();

  if (!session) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
    }
    return NextResponse.redirect(new URL("/login", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Tudo, menos arquivos estáticos do Next e ícones.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|svg|ico|webp|jpg)$).*)"],
};
