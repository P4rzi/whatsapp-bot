import type { WhatsAppStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/prisma";

// Estado operacional da conexão (linha única "default"). Nunca guarda credenciais.

export type ConnectionPatch = Partial<{
  status: WhatsAppStatus;
  phoneNumber: string | null;
  qrCode: string | null;
  qrUpdatedAt: Date | null;
  lastConnectedAt: Date | null;
  lastDisconnectedAt: Date | null;
  lastError: string | null;
}>;

export interface ConnectionStore {
  update(patch: ConnectionPatch): Promise<void>;
}

export const INSTANCE = "default";

export const prismaConnectionStore: ConnectionStore = {
  async update(patch) {
    await prisma.whatsAppConnection.upsert({
      where: { instance: INSTANCE },
      create: { instance: INSTANCE, ...patch },
      update: patch,
    });
  },
};

export function getConnection() {
  return prisma.whatsAppConnection.findUnique({ where: { instance: INSTANCE } });
}
