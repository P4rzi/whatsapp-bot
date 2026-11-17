import { Badge } from "@/components/ui/badge";
import type { InboundIntent, InboundKind } from "@/generated/prisma/enums";

export const KIND_LABELS: Record<InboundKind, string> = {
  TEXT: "Texto",
  AUDIO: "Áudio",
  IMAGE: "Imagem",
  DOCUMENT: "Documento",
  VIDEO: "Vídeo",
  STICKER: "Figurinha",
  OTHER: "Outro tipo",
};

export function IntentBadge({ intent }: { intent: InboundIntent }) {
  if (intent === "OPT_OUT") return <Badge variant="destructive">Pediu para parar</Badge>;
  if (intent === "PAYMENT_CLAIM")
    return <Badge className="bg-emerald-600/15 text-emerald-700 dark:text-emerald-300">Diz que pagou</Badge>;
  return null;
}

/** Texto da resposta, ou um rótulo para áudio/figurinha/mídia sem legenda. */
export function InboundText({ kind, text }: { kind: InboundKind; text: string | null }) {
  if (text) {
    return (
      <span className="whitespace-pre-wrap break-words">
        {kind !== "TEXT" && <span className="text-muted-foreground">[{KIND_LABELS[kind]}] </span>}
        {text}
      </span>
    );
  }
  return (
    <span className="text-muted-foreground italic">
      {KIND_LABELS[kind]}
      {kind === "AUDIO" || kind === "VIDEO" || kind === "IMAGE" || kind === "DOCUMENT" ? " — abra no WhatsApp para ver" : ""}
    </span>
  );
}
