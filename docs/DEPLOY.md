# Implantação no Railway

Guia para colocar o sistema em produção no Railway (plano Hobby). Tudo é configurado pelo painel do
Railway (o "config as code" com `railway.json` foi descontinuado pelo Railway em 01/12/2026).

## Visão geral

Um projeto Railway com três serviços:

| Serviço | Origem | Comando de start | Domínio público | Volume |
|---|---|---|---|---|
| **Postgres** | Catálogo do Railway | — | Não | Gerenciado pelo Railway |
| **web** | Este repositório (Dockerfile) | `npm run start:web` | Sim | Não |
| **worker** | Este repositório (Dockerfile) | `npm run start:worker` | **Não** | `/app/data` |

Web e worker usam a **mesma imagem** (o `Dockerfile` da raiz). O que muda é o comando de start.
Os dois conversam só pelo banco. **Somente o worker** tem o volume com a sessão do WhatsApp.

> **Importante:** o worker deve ter **exatamente 1 réplica**. Duas instâncias com a mesma sessão do
> WhatsApp derrubam uma à outra. (Volumes do Railway já impedem réplicas, e o código tem uma trava extra.)

## Passo a passo

### 1. Projeto e banco

1. No Railway, crie um projeto (ou use o existente) e adicione **Database → PostgreSQL**.
2. No serviço Postgres, aba **Backups**: ative os agendamentos **Daily** e **Weekly** (veja [Backups](#backups)).

### 2. Serviço web

1. **+ New → GitHub Repo →** este repositório. Renomeie o serviço para `web`.
2. **Settings → Build:** o Railway detecta o `Dockerfile` sozinho.
3. **Settings → Deploy:**
   - **Custom Start Command:** `npm run start:web`
   - **Pre-deploy Command:** `npm run db:migrate`
   - **Healthcheck Path:** `/api/health`
   - **Restart Policy:** On Failure
4. **Settings → Networking → Generate Domain** (ou conecte um domínio próprio).
5. **Variables** (veja a tabela abaixo): `DATABASE_URL`, `AUTH_SECRET`, `NODE_ENV`, `TIMEZONE`, `LOG_LEVEL`.

A porta é a que o Railway fornece na variável `PORT`; o `next start` já usa essa variável.

### 3. Serviço worker

1. **+ New → GitHub Repo →** o mesmo repositório. Renomeie para `worker`.
2. **Settings → Deploy:**
   - **Custom Start Command:** `npm run start:worker`
   - **Pre-deploy Command:** `npm run db:migrate` (ver [Migrações](#migrações))
   - **Healthcheck Path:** deixe vazio (o worker não tem HTTP; a saúde dele é medida pelo web)
   - **Restart Policy:** Always
   - **Replicas:** 1
3. **Não** gere domínio público para o worker.
4. **Volume:** clique com o botão direito no serviço → **Attach Volume** → mount path **`/app/data`**.
5. **Variables:** `DATABASE_URL`, `ENCRYPTION_KEY`, `WHATSAPP_SESSION_PATH=/app/data/whatsapp-session`,
   `NODE_ENV=production` e, se quiser ajustar, as demais `WORKER_*`/`MESSAGE_*`.

### 4. Administrador

Depois do primeiro deploy do web, crie o usuário administrador **dentro do container do web**
(ele já tem acesso ao banco pela rede privada). Com o [Railway CLI](https://docs.railway.com/guides/cli)
instalado e logado (`railway login`, `railway link`):

```bash
railway ssh --service web
```

E, no terminal que abrir:

```bash
ADMIN_EMAIL=voce@exemplo.com ADMIN_NAME="Seu Nome" ADMIN_PASSWORD="uma frase longa e secreta" npm run admin:create:prod
```

O mesmo comando, rodado de novo, **redefine a senha** (útil se ela for esquecida). Para trocar a senha
no dia a dia, use a tela **Configurações**.

### 5. Conectar o WhatsApp

Abra o painel → **WhatsApp → Conectar** e leia o QR Code no celular
(WhatsApp → Configurações → Dispositivos conectados → Conectar dispositivo).

### 6. Validar

- `https://SEU-DOMINIO/api/health` → `{"web":"ok","database":"ok"}`
- `https://SEU-DOMINIO/api/health/system` → `"ok": true` com o WhatsApp conectado
- Crie um cliente de teste (seu próprio número, com autorização) e uma cobrança para daqui a 2 minutos.
  Confira a mensagem no celular e o registro em **Histórico**.
- Reinicie o worker (**Deployments → Restart**) e confira que ele volta **conectado sem pedir QR**.

## Variáveis de ambiente

Use **referências** do Railway para o banco (`${{Postgres.DATABASE_URL}}`): assim web e worker usam a
rede privada e a senha nunca fica copiada à mão. Segredos (`AUTH_SECRET`, `ENCRYPTION_KEY`) podem ficar
como **Shared Variables** do projeto e ser referenciados nos serviços.

| Variável | Serviço | Obrigatória | Valor / como gerar |
|---|---|---|---|
| `DATABASE_URL` | web, worker | Sim | `${{Postgres.DATABASE_URL}}` |
| `NODE_ENV` | web, worker | Sim | `production` |
| `AUTH_SECRET` | web | Sim | `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` — trocar desloga todos |
| `ENCRYPTION_KEY` | worker | Sim | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` — **guarde em local seguro**; trocar exige novo QR |
| `WHATSAPP_SESSION_PATH` | worker | Sim | `/app/data/whatsapp-session` |
| `WORKER_POLL_INTERVAL_MS` | worker | Não | `10000` (10 s entre ciclos) |
| `MESSAGE_MAX_ATTEMPTS` | worker | Não | `3` |
| `MESSAGE_MIN_INTERVAL_MS` | worker | Não | `5000` (5 s entre envios) |
| `MESSAGE_SEND_TIMEOUT_MS` | worker | Não | `30000` |
| `RETENTION_DAYS` | worker | Não | `180` (6 meses) |
| `TIMEZONE` | web, worker | Não | `America/Sao_Paulo` |
| `LOG_LEVEL` | web, worker | Não | `info` |

Nunca coloque valores reais no repositório. O `.env` local está no `.gitignore`.

## Migrações

As migrações rodam no **Pre-deploy Command** (`npm run db:migrate` = `prisma migrate deploy`), que o
Railway executa **uma vez por deploy, antes** de a nova versão entrar no ar. Se a migração falhar, o
deploy é cancelado e a versão anterior continua rodando.

O comando está nos dois serviços porque o Railway não garante a ordem de deploy entre serviços: assim o
worker nunca sobe com código novo sobre um banco antigo. O `prisma migrate deploy` usa uma trava
(advisory lock) do Postgres: se os dois rodarem juntos, um espera o outro e o segundo não tem nada a aplicar.

Para criar uma migração nova (em desenvolvimento): `npm run db:migrate:dev -- --name descricao`, e faça commit
da pasta gerada em `prisma/migrations`.

## Deploys e atualizações

Cada push na branch `main` dispara o deploy dos dois serviços. Observações:

- O **worker fica alguns segundos fora** a cada deploy (serviços com volume não sobrepõem versões). Ao
  receber o sinal de desligamento, ele termina o envio em andamento antes de sair. As cobranças vencidas
  nesse intervalo são enviadas assim que a nova versão sobe.
- A sessão do WhatsApp fica no volume: o worker reconecta sozinho, sem novo QR.

## Backups

### Banco (essencial)

No serviço **Postgres → Backups**:

1. Ative **Daily** (mantido 6 dias) e **Weekly** (mantido ~1 mês).
2. Antes de mudanças grandes, crie um backup manual (**Backup now**).

Restaurar pelo Railway cria um volume novo a partir do backup e pede um deploy do Postgres
(**Backups → Restore**). Os backups ficam no mesmo projeto: por isso, faça também uma **cópia externa**
mensal:

```bash
pg_dump "$DATABASE_PUBLIC_URL" --format=custom --no-owner --file=backup-AAAA-MM-DD.dump
```

Guarde o arquivo em local seguro (contém dados pessoais de clientes — LGPD).

### Testar a restauração (faça pelo menos uma vez, e depois a cada poucos meses)

1. Gere um dump da produção com o comando acima.
2. Restaure no banco de **desenvolvimento** (nunca na produção):
   ```bash
   pg_restore --clean --if-exists --no-owner --dbname="URL_DO_BANCO_DE_DESENVOLVIMENTO" backup-AAAA-MM-DD.dump
   ```
3. Aponte o `.env` local para o banco de desenvolvimento, rode `npm run dev` e confira se clientes,
   cobranças e histórico aparecem.

### Sessão do WhatsApp (opcional)

Não precisa de backup: se o volume do worker se perder, basta ler o QR Code de novo. Se quiser, ative
backups também no volume do worker. Sem a `ENCRYPTION_KEY`, os arquivos da sessão são ilegíveis.

## Monitoramento

O Railway só verifica a saúde no momento do deploy. Para ser avisado depois:

1. Crie uma conta gratuita no [UptimeRobot](https://uptimerobot.com) (ou similar).
2. Monitor **HTTP(s)** para `https://SEU-DOMINIO/api/health/system`, a cada 5 minutos.
3. Alerta por e-mail quando a resposta não for 200.

Esse endpoint responde **503** se o banco, o worker (sem ciclo há mais de 2 minutos) ou o WhatsApp
estiverem com problema. Ele não expõe dados pessoais.

## Custos (estimativa)

Hobby: US$ 5/mês, com US$ 5 de uso incluídos. Web + worker + Postgres pequenos ficam tipicamente
entre US$ 5 e US$ 10/mês. Acompanhe em **Usage** no Railway e, se quiser, defina um limite de gasto.
