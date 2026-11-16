import type { NextConfig } from "next";

// Cache Components fica desligado: o painel é todo dinâmico (sessão + banco em toda página),
// então o modelo clássico (renderização sob demanda) é mais simples e previsível.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Pacotes nativos/Node que não devem ser empacotados pelo bundler.
  serverExternalPackages: ["@node-rs/argon2", "pino", "pg"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Só HTTPS por 1 ano (o Railway serve o domínio com HTTPS).
          ...(process.env.NODE_ENV === "production"
            ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }]
            : []),
        ],
      },
    ];
  },
};

export default nextConfig;
