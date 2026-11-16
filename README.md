# Cobranças automatizadas via WhatsApp

Painel web para cadastrar clientes e agendar mensagens de cobrança, com um serviço de envio (worker)
que manda as mensagens pelo WhatsApp na data e hora configuradas.

> Integração não oficial com o WhatsApp (Baileys): pode ficar instável e não há garantia de entrega.

- **Instalação e deploy no Railway:** [docs/DEPLOY.md](docs/DEPLOY.md)
- **Uso e manutenção do dia a dia:** [docs/OPERACAO.md](docs/OPERACAO.md)

## Arquitetura

Um repositório (monólito modular), dois processos:

| Processo | Comando | Responsável por |
|---|---|---|
| Web | `npm run start:web` | Painel (Next.js), login, clientes, cobranças, histórico, configurações, QR Code |
| Worker | `npm run start:worker` | Conexão WhatsApp, reconexão, fila de envio, tentativas, histórico, retenção |

Os dois se comunicam **só pelo PostgreSQL**:

- `SystemCommand`: o painel pede conectar/desconectar/reconectar; o worker executa.
- `WhatsAppConnection`: o worker publica o status e o QR Code temporário; o painel lê.
- `Charge` + `MessageAttempt`: a fila de envio e o histórico.
- `WorkerHeartbeat`: o worker registra cada ciclo; os health checks usam isso.

A sessão do WhatsApp fica **criptografada** (AES-256-GCM) no volume do worker, nunca no banco.

### Pastas principais

```
src/
├── app/            páginas (login, dashboard, clientes, cobranças, histórico, whatsapp, configurações) e APIs
├── components/     componentes de interface (shadcn/ui)
├── modules/        regras de negócio por domínio (customers, charges, messaging, whatsapp, settings, ...)
├── lib/            prisma, autenticação, env, logger, criptografia, utilitários (telefone, valor, fuso)
└── worker/         processo de envio: index, scheduler, queue, processors/, whatsapp/ (Baileys, sessão, conexão)
prisma/             schema e migrações
tests/              testes de integração (banco em schema separado) 
docs/               deploy e operação
```

## Desenvolvimento

Requisitos: Node 24 e um PostgreSQL (ex.: um banco de desenvolvimento no Railway).

```bash
npm install
cp .env.example .env     # preencha DATABASE_URL, AUTH_SECRET e ENCRYPTION_KEY
npm run db:migrate:dev   # cria as tabelas
npm run admin:create     # cria o admin (ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD no .env)
npm run dev              # painel em http://localhost:3000
npm run dev:worker       # worker, em outro terminal
```

**Testar sem número real:** rode o worker em modo simulado (PowerShell: `$env:WHATSAPP_PROVIDER='mock'; npm run dev:worker`).
O QR é "lido" sozinho após 5 s e os envios são apenas registrados. Com ele rodando,
`npx tsx --env-file=.env src/scripts/e2e-local.ts` executa um fluxo completo (conectar, cadastrar,
agendar, editar e enviar). O modo simulado é recusado em produção.

## Scripts

| Script | O que faz |
|---|---|
| `dev` / `dev:worker` | Painel e worker em desenvolvimento |
| `build` | Gera o cliente Prisma, compila o Next e empacota o worker |
| `start:web` / `start:worker` | Produção |
| `db:migrate` | Aplica migrações (produção; roda no Pre-deploy do Railway) |
| `db:migrate:dev` | Cria/aplica migrações em desenvolvimento |
| `db:generate` | Gera o cliente Prisma |
| `admin:create` / `admin:create:prod` | Cria o administrador ou redefine a senha |
| `backup` / `backup:prod` | Gera backup criptografado do banco (ver docs/DEPLOY.md) |
| `restore` / `restore:prod` | Lista (`-- --list`) ou restaura (`-- --file latest --confirm`) um backup |
| `typecheck` / `lint` / `test` | Verificações |

## Testes

`npm test` roda testes unitários e de integração. Os de integração usam o banco do `DATABASE_URL`
num **schema separado** (`vitest`), recriado a cada execução: os dados do painel não são tocados.
O WhatsApp é simulado (`MockWhatsAppProvider`): nenhum número real é necessário.

## Health checks

- `GET /api/health` — web + banco (usado pelo Railway no deploy).
- `GET /api/health/system` — web + banco + worker + WhatsApp (para monitor externo; 503 se algo falhar).
