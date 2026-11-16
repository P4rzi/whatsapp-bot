import type { Logger } from "pino";
import { maskPhone } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { renderTemplate } from "@/modules/messaging/template";
import { ProviderNotConnectedError, type WhatsAppProvider } from "@/modules/whatsapp/provider";
import { releaseCharge, UNKNOWN_RESULT_MESSAGE } from "../queue";

// Processa UMA cobrança já reservada (PROCESSING) por esta instância.
//
// Regra de ouro contra mensagens duplicadas: a tentativa é gravada como STARTED antes de
// chamar o WhatsApp. Depois disso, só existe nova tentativa automática se tivermos certeza
// de que nada saiu (ProviderNotConnectedError). Timeout ou erro no meio do envio = UNKNOWN,
// a cobrança fica FAILED e só é reenviada se o usuário pedir.

export type ProcessorDeps = {
  provider: WhatsAppProvider;
  instanceId: string;
  logger: Logger;
  maxAttempts: number;
  sendTimeoutMs: number;
  /** Espera antes da tentativa N+1 (índice = tentativas já feitas - 1). */
  retryDelaysMs?: number[];
  /** Atraso máximo em relação ao horário agendado; passou disso, não envia sozinho. 0/undefined = sem limite. */
  maxDelayMs?: number;
};

export const DEFAULT_RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000];

export type ProcessOutcome = "sent" | "failed" | "retry_scheduled" | "released" | "unknown" | "skipped";

class TimeoutError extends Error {}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError(`sem resposta em ${Math.round(ms / 1000)}s`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 500);

export async function processCharge(chargeId: string, deps: ProcessorDeps): Promise<ProcessOutcome> {
  const { provider, instanceId, logger } = deps;
  const startedAt = Date.now();
  const charge = await prisma.charge.findUnique({ where: { id: chargeId }, include: { customer: true } });
  if (!charge || charge.status !== "PROCESSING" || charge.lockedBy !== instanceId) return "skipped";

  const log = logger.child({ chargeId, phone: maskPhone(charge.customer.phone) });
  const attemptNumber = (await prisma.messageAttempt.count({ where: { chargeId } })) + 1;

  /** Atualiza a cobrança só se ainda for nossa (protege contra recuperação concorrente). */
  const finishCharge = (data: Parameters<typeof prisma.charge.updateMany>[0]["data"]) =>
    prisma.charge.updateMany({
      where: { id: chargeId, status: "PROCESSING", lockedBy: instanceId },
      data: { ...data, lockedAt: null, lockedBy: null },
    });

  /** Falha definitiva sem envio (regra de negócio): registra no histórico e encerra. */
  const failWithoutSending = async (reason: string) => {
    await prisma.messageAttempt.create({
      data: { chargeId, attemptNumber, status: "FAILED", errorMessage: reason, finishedAt: new Date() },
    });
    await finishCharge({ status: "FAILED", lastError: reason });
    log.warn({ reason }, "cobrança não enviada");
    return "failed" as const;
  };

  /** Falha em que com certeza nada foi enviado: agenda nova tentativa (ou desiste no limite). */
  const failRetryable = async (reason: string, attemptRecorded: boolean) => {
    if (!attemptRecorded) {
      await prisma.messageAttempt.create({
        data: { chargeId, attemptNumber, status: "FAILED", errorMessage: reason, finishedAt: new Date() },
      });
    }
    const attemptsInRound = charge.attemptCount + 1;
    if (attemptsInRound >= deps.maxAttempts) {
      await finishCharge({ status: "FAILED", attemptCount: attemptsInRound, lastError: `${reason} (limite de ${deps.maxAttempts} tentativas)` });
      log.warn({ reason, attempts: attemptsInRound }, "cobrança falhou após o limite de tentativas");
      return "failed" as const;
    }
    const delays = deps.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
    const delay = delays[Math.min(attemptsInRound - 1, delays.length - 1)];
    await finishCharge({
      status: "PENDING",
      attemptCount: attemptsInRound,
      nextAttemptAt: new Date(Date.now() + delay),
      lastError: reason,
    });
    log.info({ reason, attempt: attemptsInRound, retryInMs: delay }, "nova tentativa agendada");
    return "retry_scheduled" as const;
  };

  // 1) Regras de envio (LGPD e cadastro).
  if (!charge.customer.isActive) return failWithoutSending("Cliente inativo.");
  if (charge.customer.optedOutAt) return failWithoutSending("Cliente pediu para não receber mensagens.");
  if (!charge.customer.consentAt) return failWithoutSending("Cliente sem autorização registrada para receber mensagens.");

  // 1b) Muito atrasada (ex.: WhatsApp ficou dias desconectado): não manda um lembrete fora de hora
  //     sem o usuário conferir. Reenvio manual zera isso (usa nextAttemptAt como referência).
  if (deps.maxDelayMs && deps.maxDelayMs > 0) {
    const reference = charge.nextAttemptAt ?? charge.scheduledAt;
    if (Date.now() - reference.getTime() > deps.maxDelayMs) {
      const hours = Math.round(deps.maxDelayMs / 3_600_000);
      return failWithoutSending(
        `Não enviada: passou mais de ${hours}h do horário agendado (o envio estava parado). Use Reenviar se ainda fizer sentido.`,
      );
    }
  }

  // 2) Conexão: se caiu entre a reserva e agora, devolve para a fila sem gastar tentativa.
  if (!provider.isConnected()) {
    await releaseCharge(chargeId, instanceId);
    log.info("WhatsApp desconectado; cobrança devolvida para a fila");
    return "released";
  }

  const text = renderTemplate(charge.message, {
    name: charge.customer.name,
    amount: charge.amount?.toString() ?? null,
    description: charge.description,
    scheduledAt: charge.scheduledAt,
  });

  // 3) Número tem WhatsApp? (consulta, nada é enviado ainda)
  let recipient: string | null;
  try {
    recipient = await withTimeout(provider.resolveRecipient(charge.customer.phone), deps.sendTimeoutMs);
  } catch (err) {
    if (err instanceof ProviderNotConnectedError) {
      await releaseCharge(chargeId, instanceId);
      return "released";
    }
    return failRetryable(`Falha ao consultar o número: ${errMsg(err)}`, false);
  }
  if (!recipient) return failWithoutSending("Este número não tem WhatsApp.");

  // 4) Marca a tentativa ANTES de enviar. Se o processo cair daqui em diante, a recuperação
  //    vê o STARTED e não reenvia.
  const attempt = await prisma.messageAttempt.create({
    data: { chargeId, attemptNumber, status: "STARTED", renderedMessage: text },
  });

  // 5) Envio.
  try {
    const result = await withTimeout(provider.sendText(recipient, text), deps.sendTimeoutMs);
    const now = new Date();
    await prisma.messageAttempt.update({
      where: { id: attempt.id },
      data: { status: "SUCCESS", providerMessageId: result.providerMessageId, finishedAt: now },
    });
    await finishCharge({ status: "SENT", sentAt: now, attemptCount: charge.attemptCount + 1, lastError: null, nextAttemptAt: null });
    log.info({ ms: Date.now() - startedAt, attempt: attemptNumber }, "mensagem enviada");
    return "sent";
  } catch (err) {
    if (err instanceof ProviderNotConnectedError) {
      // Recusado antes de ir para a rede: seguro tentar de novo.
      await prisma.messageAttempt.update({
        where: { id: attempt.id },
        data: { status: "FAILED", errorMessage: "WhatsApp desconectado antes do envio.", finishedAt: new Date() },
      });
      return failRetryable("WhatsApp desconectado antes do envio.", true);
    }
    // Timeout ou erro durante o envio: não dá para saber se saiu. Não reenvia sozinho.
    const detail = err instanceof TimeoutError ? `Sem confirmação do WhatsApp (${err.message}).` : `Erro no envio: ${errMsg(err)}.`;
    const message = `${detail} ${UNKNOWN_RESULT_MESSAGE}`;
    await prisma.messageAttempt.update({
      where: { id: attempt.id },
      data: { status: "UNKNOWN", errorMessage: message, finishedAt: new Date() },
    });
    await finishCharge({ status: "FAILED", attemptCount: charge.attemptCount + 1, lastError: message });
    log.error({ err: errMsg(err) }, "resultado do envio desconhecido; não será reenviado automaticamente");
    return "unknown";
  }
}
