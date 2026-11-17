import type { IncomingMessage } from "@/modules/whatsapp/provider";

// Extrai o que interessa de uma mensagem recebida do WhatsApp (formato do Baileys), sem depender
// do socket: filtra grupos, status, canais, mensagens próprias, reações e avisos técnicos.

type Content = Record<string, unknown> | null | undefined;
export type RawMessage = {
  key: { remoteJid?: string | null; remoteJidAlt?: string | null; fromMe?: boolean | null; id?: string | null };
  message?: Content;
  messageTimestamp?: number | bigint | { toNumber(): number } | null;
};

const MAX_TEXT = 2000;

/** Conversa individual com uma pessoa? (exclui grupos, status, listas de transmissão e canais) */
export function isPersonalChat(jid: string | null | undefined): boolean {
  if (!jid) return false;
  return jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid");
}

/** "5511987654321:12@s.whatsapp.net" -> "5511987654321"; só para JIDs de telefone. */
export function phoneFromJid(jid: string | null | undefined): string | null {
  if (!jid || !jid.endsWith("@s.whatsapp.net")) return null;
  const user = jid.split("@")[0].split(":")[0];
  return /^\d{8,15}$/.test(user) ? user : null;
}

/** Desembrulha mensagens temporárias, de visualização única e editadas. */
function unwrap(content: Content): Content {
  let c = content;
  for (let i = 0; i < 5 && c; i++) {
    const inner =
      (c.ephemeralMessage as { message?: Content })?.message ??
      (c.viewOnceMessage as { message?: Content })?.message ??
      (c.viewOnceMessageV2 as { message?: Content })?.message ??
      (c.viewOnceMessageV2Extension as { message?: Content })?.message ??
      (c.documentWithCaptionMessage as { message?: Content })?.message ??
      (c.editedMessage as { message?: Content })?.message;
    if (!inner) break;
    c = inner;
  }
  return c;
}

const clip = (s: unknown): string | null => {
  if (typeof s !== "string") return null;
  const t = s.trim();
  return t ? t.slice(0, MAX_TEXT) : null;
};

/** Tipo e texto da mensagem; null = não é algo para registrar (reação, apagada, aviso técnico...). */
export function extractContent(raw: Content): { kind: IncomingMessage["kind"]; text: string | null } | null {
  const c = unwrap(raw);
  if (!c) return null;
  if (c.reactionMessage || c.protocolMessage || c.senderKeyDistributionMessage || c.pollUpdateMessage) return null;
  if (typeof c.conversation === "string") return { kind: "TEXT", text: clip(c.conversation) };
  const ext = c.extendedTextMessage as { text?: string } | undefined;
  if (ext) return { kind: "TEXT", text: clip(ext.text) };
  const img = c.imageMessage as { caption?: string } | undefined;
  if (img) return { kind: "IMAGE", text: clip(img.caption) };
  const vid = c.videoMessage as { caption?: string } | undefined;
  if (vid) return { kind: "VIDEO", text: clip(vid.caption) };
  if (c.audioMessage) return { kind: "AUDIO", text: null };
  const doc = c.documentMessage as { caption?: string; fileName?: string } | undefined;
  if (doc) return { kind: "DOCUMENT", text: clip(doc.caption) ?? clip(doc.fileName) };
  if (c.stickerMessage) return { kind: "STICKER", text: null };
  const btn = (c.buttonsResponseMessage as { selectedDisplayText?: string })?.selectedDisplayText;
  if (btn) return { kind: "TEXT", text: clip(btn) };
  return { kind: "OTHER", text: null };
}

function toDate(ts: RawMessage["messageTimestamp"]): Date {
  if (ts === null || ts === undefined) return new Date();
  const seconds = typeof ts === "object" ? ts.toNumber() : Number(ts);
  return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date();
}

/**
 * Converte a mensagem bruta. `resolveLid` traduz um identificador LID (formato novo do WhatsApp,
 * que esconde o telefone) para o JID de telefone, quando o mapeamento é conhecido.
 */
export async function parseIncoming(
  raw: RawMessage,
  resolveLid: (lid: string) => Promise<string | null>,
): Promise<IncomingMessage | null> {
  const { key } = raw;
  if (key.fromMe || !key.id || !isPersonalChat(key.remoteJid)) return null;
  const content = extractContent(raw.message);
  if (!content) return null;

  let phone = phoneFromJid(key.remoteJid) ?? phoneFromJid(key.remoteJidAlt);
  if (!phone && key.remoteJid?.endsWith("@lid")) {
    phone = phoneFromJid(await resolveLid(key.remoteJid).catch(() => null));
  }
  if (!phone) return null; // sem como saber quem é: não registra

  return { phone, providerMessageId: key.id, kind: content.kind, text: content.text, receivedAt: toDate(raw.messageTimestamp) };
}
