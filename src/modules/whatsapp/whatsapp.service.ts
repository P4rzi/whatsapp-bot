import QRCode from "qrcode";
import type { WhatsAppStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";
import { getConnection } from "./connection.repository";

// Visão do painel sobre a conexão. Nunca expõe credenciais da sessão:
// só o estado operacional e o QR temporário (como imagem), para o admin logado.

/** Sem batimento do worker há mais que isso = serviço de envio parado. */
const WORKER_STALE_MS = 60_000;
/** QR mais antigo que isso já expirou no WhatsApp (ele troca a cada ~20s). */
const QR_MAX_AGE_MS = 60_000;

export type WhatsAppStatusView = {
  status: WhatsAppStatus;
  phoneNumber: string | null;
  qrDataUrl: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastError: string | null;
  workerOnline: boolean;
  pendingCommand: string | null;
  updatedAt: string | null;
};

export async function getWhatsAppStatusView(): Promise<WhatsAppStatusView> {
  const [conn, heartbeat, pending] = await Promise.all([
    getConnection(),
    prisma.workerHeartbeat.findUnique({ where: { id: "worker" }, select: { lastCycleAt: true } }),
    prisma.systemCommand.findFirst({
      where: { status: { in: ["PENDING", "PROCESSING"] } },
      orderBy: { createdAt: "desc" },
      select: { type: true },
    }),
  ]);

  const now = Date.now();
  const qrFresh = conn?.qrCode && conn.qrUpdatedAt && now - conn.qrUpdatedAt.getTime() < QR_MAX_AGE_MS;
  const qrDataUrl =
    conn?.status === "QR_CODE_REQUIRED" && qrFresh
      ? await QRCode.toDataURL(conn.qrCode!, { margin: 1, width: 280, errorCorrectionLevel: "L" })
      : null;

  return {
    status: conn?.status ?? "DISCONNECTED",
    phoneNumber: conn?.phoneNumber ?? null,
    qrDataUrl,
    lastConnectedAt: conn?.lastConnectedAt?.toISOString() ?? null,
    lastDisconnectedAt: conn?.lastDisconnectedAt?.toISOString() ?? null,
    lastError: conn?.lastError ?? null,
    workerOnline: !!heartbeat && now - heartbeat.lastCycleAt.getTime() < WORKER_STALE_MS,
    pendingCommand: pending?.type ?? null,
    updatedAt: conn?.updatedAt.toISOString() ?? null,
  };
}
