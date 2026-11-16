import "dotenv/config";

// Cada arquivo de teste aponta para o schema "vitest" (criado em global-setup.ts).
// - ?schema=vitest: consultas geradas pelo Prisma usam o schema "vitest".
// - options=-c search_path=vitest: SQL bruto também, nunca o "public".
const base = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (base) {
  const url = new URL(base);
  url.searchParams.set("schema", "vitest");
  url.searchParams.set("options", "-c search_path=vitest");
  process.env.DATABASE_URL = url.toString();
}
process.env.AUTH_SECRET ??= "test-secret-test-secret-test-secret-123456";
