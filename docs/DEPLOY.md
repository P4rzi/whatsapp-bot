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
2. Backups: veja [Backups](#backups) (os automáticos do Railway exigem o plano Pro).

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
   - **Restart Policy:** On Failure (reinicia sempre que o processo cai com erro; o worker só sai sozinho em caso de erro)
   - **Replicas:** 1
3. **Não** gere domínio público para o worker.
4. **Volume:** **+ Add → Volume →** escolha o serviço `worker` → mount path **`/app/data`**.
5. **Variables:** `DATABASE_URL`, `ENCRYPTION_KEY`, `WHATSAPP_SESSION_PATH=/app/data/whatsapp-session`,
   `NODE_ENV=production` e, se quiser ajustar, as demais `WORKER_*`/`MESSAGE_*`.

### 4. Administrador

Depois do primeiro deploy do web, crie o usuário administrador **dentro do container do web**
(ele já tem acesso ao banco pela rede privada): abra o serviço **web → aba Console** no painel do
Railway (em tela de computador; a versão de celular não mostra o terminal). Alternativa: Railway CLI
com `railway ssh --service web`.

No terminal (prompt `root@...:/app#`):

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
| `MESSAGE_MAX_DELAY_HOURS` | worker | Não | `72` — cobrança atrasada além disso não é enviada sozinha (0 = sem limite) |
| `WHATSAPP_PROVIDER` | worker | Não | `baileys` (o valor `mock` é só para testes locais e é recusado em produção) |
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

Os backups automáticos do Railway (aba **Postgres → Backups**) exigem o plano **Pro** (verificado em
16/11/2026). Por isso o sistema tem um **backup próprio**: o script `npm run backup:prod` exporta todas as
tabelas, compacta e **criptografa** (AES-256-GCM) e envia para um armazenamento compatível com S3, apagando
as cópias mais antigas. Ele não depende do `pg_dump` nem da versão do Postgres.

**Onde guardar** (escolha um; o código é o mesmo, só mudam as variáveis):

| Destino | Prós | Contras |
|---|---|---|
| **Bucket do Railway** (+ Add → Bucket) | Tudo no mesmo painel, custo de centavos | A cópia fica no mesmo provedor |
| **Cloudflare R2 / Backblaze B2** | Cópia fora do Railway (mais seguro), camada gratuita | Exige conta em outro serviço |

#### Configurar o serviço de backup agendado

1. Gere uma chave **só para os backups** e guarde num gerenciador de senhas (sem ela, os backups são ilegíveis):
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. Crie o destino (Bucket do Railway, ou bucket no R2/B2) e anote: endpoint, nome do bucket, região,
   access key e secret key.
3. No projeto Railway: **+ Add → GitHub Repository → whatsapp-bot**, renomeie para `backup`.
4. **Settings → Deploy:** Custom Start Command `npm run backup:prod`; **Cron Schedule** `0 6 * * *`
   (todo dia às 6h UTC = 3h de Brasília); Restart Policy **Never**. Sem domínio, sem volume, sem pre-deploy.
5. **Variables:**

   | Variável | Valor |
   |---|---|
   | `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
   | `NODE_ENV` | `production` |
   | `BACKUP_ENCRYPTION_KEY` | a chave do passo 1 |
   | `BACKUP_KEEP` | `14` (backups mantidos) |
   | `BACKUP_S3_BUCKET` | nome do bucket |
   | `BACKUP_S3_ENDPOINT` | endpoint S3 (vazio só para AWS) |
   | `BACKUP_S3_REGION` | região (`auto` no R2) |
   | `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` | credenciais |

6. Deploy. Nos logs do serviço deve aparecer `backup concluído` com a quantidade de registros.

#### Restaurar

Sempre teste primeiro no banco de **desenvolvimento**. Localmente, com as variáveis `BACKUP_*` no `.env`
e o `DATABASE_URL` apontando para o banco de destino:

```bash
npm run restore -- --list
npm run restore -- --file latest --confirm
```

A restauração **substitui** todos os dados do banco de destino, numa única transação. Em produção, rode no
Console do serviço web (`npm run restore:prod -- ...`) com `RESTORE_ALLOW_PRODUCTION=sim`.

**Teste de restauração:** faça uma vez após configurar e depois a cada poucos meses (restaure o backup mais
recente no banco de desenvolvimento e confira clientes, cobranças e histórico no painel local).

No plano Pro, os backups do próprio Railway (**Postgres → Backups**, Daily + Weekly) também podem ser ativados.

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
