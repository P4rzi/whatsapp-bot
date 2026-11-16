# Manual de operação

Como usar e manter o sistema no dia a dia. Para instalação, veja [DEPLOY.md](DEPLOY.md).

## Rotina

1. **Clientes:** cadastre nome e telefone (com DDD). Só marque **"Autorizou receber mensagens"** se o
   cliente realmente autorizou, e informe como (contrato, WhatsApp, verbal…). Sem isso nada é enviado.
2. **Cobranças:** escolha o cliente, a descrição, o valor (opcional), a data e o horário (de Brasília)
   e confira a **prévia**: é exatamente o texto que será enviado.
3. Na hora marcada, o serviço de envio manda a mensagem. Acompanhe em **Cobranças** e **Histórico**.
4. Para desistir de uma cobrança ainda não enviada, use **Cancelar**.

## Status das cobranças

| Status | Significado |
|---|---|
| **Agendada** | Aguardando o horário (ou uma nova tentativa automática). |
| **Enviando** | O serviço está enviando agora. Não pode ser cancelada. |
| **Enviada** | O WhatsApp confirmou o envio. *Confirmação de envio não é confirmação de leitura.* |
| **Falhou** | Não foi enviada. O motivo aparece na lista e no Histórico. |
| **Cancelada** | Cancelada por você; nunca será enviada. |

### Motivos de falha mais comuns

| Motivo | O que fazer |
|---|---|
| Cliente sem autorização / inativo / descadastrado | Corrija o cadastro se for o caso e use **Reenviar**. |
| Este número não tem WhatsApp | Confira o telefone no cadastro (DDD, 9º dígito). |
| Limite de tentativas | Houve instabilidade repetida. Confira a conexão e use **Reenviar**. |
| **Resultado desconhecido** | Veja abaixo. |

### "Resultado desconhecido"

Acontece quando o WhatsApp não confirmou o envio a tempo, ou o serviço caiu no meio do envio. A mensagem
**pode ter chegado ou não**. Para não mandar mensagens duplicadas, o sistema **não reenvia sozinho**.

1. Abra a conversa com o cliente no WhatsApp do celular.
2. Se a mensagem **está lá**: não faça nada.
3. Se **não está**: no Histórico, clique em **Reenviar** → **Conferi, reenviar**.

## Conexão do WhatsApp

| Status | Significado | Ação |
|---|---|---|
| **Conectado** | Tudo certo. | — |
| **Aguardando QR Code** | Esperando a leitura do QR. | Leia o QR no celular. Ele expira em ~2 minutos. |
| **Conectando / Reconectando** | Caiu e o sistema está tentando voltar sozinho (espera crescente). | Aguarde alguns minutos. |
| **Desconectado** | Sem sessão (nunca conectou, QR expirou ou alguém desconectou no celular). | **Conectar** e ler o QR. |
| **Erro** | Desistiu de reconectar sozinho (sessão aberta em outro lugar, conta restrita ou muitas falhas). | Leia a mensagem; tente **Reconectar**. Se não resolver, **Desconectar** e **Conectar** de novo. |

- Enquanto o WhatsApp estiver desconectado, as cobranças vencidas **ficam aguardando** (não se perdem
  nem falham) e são enviadas quando a conexão voltar.
- **Trocar o número que envia:** **Desconectar** e depois **Conectar** lendo o QR com o outro celular.
- O celular precisa ficar ligado e com internet de vez em quando; se ficar ~14 dias sem conectar, o
  WhatsApp desconecta os aparelhos vinculados.

### Cuidados para evitar bloqueio do número

Esta integração usa o WhatsApp Web de forma **não oficial**; o WhatsApp pode restringir números que
parecem enviar spam. Para reduzir o risco:

- Envie apenas para quem autorizou e espera a mensagem.
- Mensagens claras e personalizadas (use `{{nome}}`), sem links suspeitos.
- Evite agendar dezenas de mensagens para o mesmo minuto; espalhe os horários.
- Atenda pedidos de "parar de receber" marcando **"Pediu para não receber mais"** no cliente.

Não há garantia de entrega das mensagens.

## Serviço de envio parado

O dashboard e a tela WhatsApp avisam quando o serviço de envio (worker) não responde, e o monitor
externo (UptimeRobot) manda e-mail. No Railway:

1. Abra o serviço **worker → Deployments** e veja os logs do deploy ativo.
2. **Restart** no deploy resolve a maioria dos casos. A sessão do WhatsApp é mantida.
3. Se aparecer "Outra instância do worker está usando esta sessão", confira se há só **1 réplica**.
4. Erro de decifragem da sessão: a `ENCRYPTION_KEY` mudou. Volte a chave anterior ou **Desconectar/Conectar**
   para gerar uma sessão nova.

## LGPD

- **Consentimento:** registrado no cadastro do cliente (data e origem). Sem ele, nada é enviado.
- **Descadastro:** marque "Pediu para não receber mais". Bloqueia todos os envios imediatamente.
- **Pedido de exclusão de dados:** exclua o cliente. Cliente, cobranças e histórico são apagados
  definitivamente (antes, cancele as cobranças agendadas).
- **Retenção:** o histórico de tentativas é apagado automaticamente após 6 meses.
- **Logs:** não guardam senhas, credenciais do WhatsApp nem telefones completos.
- **Backups** contêm dados pessoais: guarde as cópias externas em local seguro e apague as antigas.

## Segurança

- Use uma senha longa no painel e troque em **Configurações** se suspeitar de vazamento (as outras
  sessões abertas são encerradas na hora).
- Após 5 senhas erradas, o login fica bloqueado por 15 minutos.
- Esqueceu a senha? Rode de novo o `admin:create` (ver DEPLOY.md, passo 4).
- Guarde `AUTH_SECRET` e `ENCRYPTION_KEY` fora do repositório (gerenciador de senhas).
- A sessão do WhatsApp fica criptografada no volume do worker e nunca é exposta pelo painel.

## Logs

No Railway, cada serviço tem a aba de logs (formato JSON). Eventos úteis para buscar:
`mensagem enviada`, `nova tentativa agendada`, `resultado do envio desconhecido`, `WhatsApp conectado`,
`conexão com o WhatsApp encerrada`, `reconexão agendada`, `comando recebido`, `login realizado`.
