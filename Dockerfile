# Imagem única para os dois serviços do Railway.
#   Web:    npm run start:web     (Pre-deploy: npm run db:migrate)
#   Worker: npm run start:worker  (volume em /app/data)
# O comando de start de cada serviço é definido no painel do Railway.

FROM node:24-bookworm-slim AS base
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

# --- Dependências (inclui devDependencies para o build) ---
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci

# --- Build: cliente Prisma, Next.js e bundle do worker ---
FROM deps AS build
COPY . .
RUN npm run build \
  && npm prune --omit=dev

# --- Execução ---
FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts /app/next.config.ts ./
# Ponto de montagem do volume do worker (credenciais do WhatsApp).
# O volume do Railway é montado como root, por isso o processo roda como root no container.
RUN mkdir -p /app/data
CMD ["npm", "run", "start:web"]
