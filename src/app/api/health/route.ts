import { connection } from "next/server";
import { getHealthReport } from "@/modules/health/health.service";

// Health check do serviço web (usado pelo Railway no deploy).
// Responde 200 se o web e o banco estão de pé, mesmo que o worker esteja fora:
// assim um problema no worker não impede o deploy do painel.
export async function GET() {
  await connection();
  const report = await getHealthReport();
  const status = report.database === "ok" ? 200 : 503;
  return Response.json(
    { web: report.web, database: report.database, checkedAt: report.checkedAt },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}
