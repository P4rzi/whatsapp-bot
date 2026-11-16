import { execSync } from "node:child_process";
import "dotenv/config";

// Os testes de integração usam um schema separado ("vitest") no banco de desenvolvimento,
// para nunca tocar nos dados usados no painel. O schema é recriado a cada execução.
export default function setup() {
  const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!base) throw new Error("Defina DATABASE_URL (ou TEST_DATABASE_URL) no .env para rodar os testes.");
  if (process.env.NODE_ENV === "production") throw new Error("Testes não podem rodar com NODE_ENV=production.");

  const url = new URL(base);
  url.searchParams.set("schema", "vitest");
  process.env.DATABASE_URL = url.toString();

  execSync("npx prisma db execute --stdin", {
    input: 'DROP SCHEMA IF EXISTS "vitest" CASCADE; CREATE SCHEMA "vitest";',
    env: process.env,
    stdio: ["pipe", "ignore", "inherit"],
  });
  execSync("npx prisma migrate deploy", { env: process.env, stdio: ["ignore", "ignore", "inherit"] });
}
