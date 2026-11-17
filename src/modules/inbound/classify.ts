// Classifica a resposta de um cliente para destacar no painel o que precisa de atenção.
// Não responde nada e não muda nada sozinho: só ajuda o usuário a encontrar o que importa.

export type InboundIntent = "OPT_OUT" | "PAYMENT_CLAIM" | "OTHER";
export type InboundKind = "TEXT" | "AUDIO" | "IMAGE" | "DOCUMENT" | "VIDEO" | "STICKER" | "OTHER";

/** minúsculas, sem acentos, espaços simples */
export function normalizeText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const OPT_OUT_PATTERNS = [
  /^(sair|parar|pare|stop|cancelar|descadastrar)[.! ]*$/,
  /\b(quero|queria|gostaria de) (sair|parar|cancelar)\b/,
  /\bnao (quero|desejo|gostaria de) (mais )?receber\b/,
  /\b(para|pare|parem|parar) de (me )?(mandar|enviar|cobrar|mensagem)/,
  /\b(nao|n) (me )?(mande|mandem|envie|enviem) mais\b/,
  /\b(me )?(tire|tira|remova|remove|exclua|apague)\b.{0,30}\b(lista|contato|numero|cadastro)\b/,
  /\bdescadastr/,
  /\bspam\b/,
  /\b(vou|irei) (te )?(bloquear|denunciar)\b/,
];

const PAYMENT_PATTERNS = [
  /\b(ja|acabei de|eu) (paguei|pague|quitei|transferi|fiz o pix|fiz o pagamento|efetuei)\b/,
  /\bpaguei\b/,
  /\b(acabei de|ja|consegui) (pagar|transferir|depositar|quitar)\b/,
  /\b(acabei de|ja) (fazer|mandar|enviar) (o|a) (pix|pagamento|deposito|transferencia)\b/,
  /\b(fiz|mandei|enviei) (o|a) (pix|pagamento|deposito|transferencia)\b/,
  /\b(ta|esta|ja esta|ja ta) (pago|quitado|pago ja)\b/,
  /\bpagamento (feito|realizado|efetuado|confirmado)\b/,
  /\b(pix|transferencia|deposito) (feito|realizado|enviado|efetuado)\b/,
  /\bcomprovante\b/,
  /\bja (foi|esta) pago\b/,
];

/** Frases que negam o pagamento ("ainda não paguei") não contam como aviso de pagamento. */
const PAYMENT_NEGATION = /\b(nao|ainda nao|n) (paguei|pago|consegui pagar|fiz)\b|\bvou pagar\b|\bpago (amanha|semana|mes|dia)\b/;

export function classifyInbound(text: string | null | undefined, kind: InboundKind): InboundIntent {
  const t = normalizeText(text ?? "");
  if (t) {
    if (OPT_OUT_PATTERNS.some((re) => re.test(t))) return "OPT_OUT";
    if (!PAYMENT_NEGATION.test(t) && PAYMENT_PATTERNS.some((re) => re.test(t))) return "PAYMENT_CLAIM";
  }
  // Documento (PDF) sem texto geralmente é comprovante; imagem fica como "outra" (pode ser qualquer coisa),
  // mas o painel mostra o tipo para o usuário conferir no celular.
  if (!t && kind === "DOCUMENT") return "PAYMENT_CLAIM";
  return "OTHER";
}

/**
 * Variações do mesmo número brasileiro: o WhatsApp de contas antigas às vezes usa o celular
 * sem o 9 (55 11 8765-4321) enquanto o cadastro tem com o 9 (55 11 98765-4321), e vice-versa.
 */
export function phoneVariants(digits: string): string[] {
  const out = new Set([digits]);
  if (digits.startsWith("55") && digits.length === 13 && digits[4] === "9") {
    out.add(digits.slice(0, 4) + digits.slice(5)); // sem o 9
  }
  if (digits.startsWith("55") && digits.length === 12 && /[6-9]/.test(digits[4])) {
    out.add(digits.slice(0, 4) + "9" + digits.slice(4)); // com o 9 (só celulares: começam com 6-9)
  }
  return [...out];
}
