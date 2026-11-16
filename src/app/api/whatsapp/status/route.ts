import { connection } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { getWhatsAppStatusView } from "@/modules/whatsapp/whatsapp.service";

// Status da conexão para o polling da tela WhatsApp. Só para o admin logado.
export async function GET() {
  await connection();
  if (!(await getCurrentUser())) {
    return Response.json({ error: "Não autenticado" }, { status: 401 });
  }
  return Response.json(await getWhatsAppStatusView(), { headers: { "Cache-Control": "no-store" } });
}
