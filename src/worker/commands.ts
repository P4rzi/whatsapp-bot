import type { Logger } from "pino";
import { claimNextCommand, completeCommand } from "@/modules/whatsapp/command.repository";
import type { ConnectionManager } from "./whatsapp/connection";

/** Processa todos os comandos pendentes do painel, um por vez. */
export async function processCommands(manager: ConnectionManager, logger: Logger): Promise<number> {
  let processed = 0;
  for (;;) {
    const cmd = await claimNextCommand();
    if (!cmd) return processed;
    processed++;
    logger.info({ commandId: cmd.id, type: cmd.type }, "comando recebido");
    try {
      switch (cmd.type) {
        case "CONNECT_WHATSAPP":
          await manager.connect();
          break;
        case "DISCONNECT_WHATSAPP":
          await manager.disconnect();
          break;
        case "RESTART_WHATSAPP":
          await manager.restart();
          break;
      }
      await completeCommand(cmd.id);
    } catch (err) {
      logger.error({ err, commandId: cmd.id }, "falha ao processar comando");
      await completeCommand(cmd.id, err instanceof Error ? err.message : String(err));
    }
  }
}
