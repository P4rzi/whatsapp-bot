// Empacota o worker (TypeScript) em um único arquivo ESM executável com Node.
// As dependências de node_modules ficam externas; o código do projeto (incluindo
// o cliente Prisma gerado) é incluído no bundle.
import { build } from "esbuild";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

await build({
  entryPoints: [path.join(root, "src/worker/index.ts")],
  outfile: path.join(root, "dist/worker/index.mjs"),
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  packages: "external",
  sourcemap: true,
  alias: { "@": path.join(root, "src") },
  banner: {
    // Permite que dependências CommonJS usem require() dentro do bundle ESM.
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
  logLevel: "info",
});
