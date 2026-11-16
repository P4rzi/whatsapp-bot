import { redirect } from "next/navigation";

// A raiz leva ao painel; o proxy de autenticação (Etapa 2) manda para o login quando necessário.
export default function Home() {
  redirect("/dashboard");
}
