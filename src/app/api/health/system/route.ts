import { connection } from "next/server";
import { getHealthReport } from "@/modules/health/health.service";

// Health check completo (web + banco + worker + WhatsApp), para o monitor externo (UptimeRobot).
// Responde 503 se qualquer parte estiver com problema. Não expõe dados sensíveis.
export async function GET() {
  await connection();
  const report = await getHealthReport();
  return Response.json(report, {
    status: report.ok ? 200 : 503,
    headers: { "Cache-Control": "no-store" },
  });
}
