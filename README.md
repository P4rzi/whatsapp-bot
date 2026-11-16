# Cobranças automatizadas via WhatsApp

Painel web para cadastrar clientes e agendar mensagens de cobrança, com um worker
que envia as mensagens pelo WhatsApp (Baileys) na data e hora configuradas.

> Integração não oficial com o WhatsApp: pode ficar instável e não há garantia de entrega.

## Arquitetura

Um repositório, dois processos:

| Processo | Comando | Responsável por |
|---|---|---|
| Web | `npm run start:web` | Painel (Next.js), login, clientes, cobranças, histórico, QR Code |
| Worker | `npm run start:worker` | Conexão WhatsApp, fila de envio, reconexão, registro de resultados |

Os dois se comunicam só pelo PostgreSQL (tabelas `SystemCommand`, `WhatsAppConnection`,
`WorkerHeartbeat`). As credenciais do WhatsApp ficam criptografadas no volume do worker.

## Desenvolvimento

Requisitos: Node 24.

```bash
npm install
cp .env.example .env   # preencha DATABASE_URL, AUTH_SECRET e ENCRYPTION_KEY
npm run db:migrate:dev
npm run dev            # painel em http://localhost:3000
npm run dev:worker     # worker em outro terminal
```

## Scripts

| Script | O que faz |
|---|---|
| `dev` / `dev:worker` | Painel e worker em modo desenvolvimento |
| `build` | Gera o cliente Prisma, compila o Next e empacota o worker |
| `start:web` / `start:worker` | Produção |
| `db:migrate` | Aplica migrações (produção; roda no Pre-deploy do Railway) |
| `db:migrate:dev` | Cria/aplica migrações em desenvolvimento |
| `db:generate` | Gera o cliente Prisma |
| `typecheck` / `lint` / `test` | Verificações |

## Health checks

- `GET /api/health` — web + banco (usado pelo Railway no deploy).
- `GET /api/health/system` — web + banco + worker + WhatsApp (para monitor externo; 503 se algo falhar).
