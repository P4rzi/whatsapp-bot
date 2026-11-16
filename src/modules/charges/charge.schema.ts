import { z } from "zod";
import { localToUtc } from "@/lib/utils/datetime";
import { parseMoney } from "@/lib/utils/money";
import { usesVariable } from "@/modules/messaging/template";

/** Tolerância para "agora": permite agendar para o minuto atual. */
const PAST_TOLERANCE_MS = 60_000;

// Formato do formulário (strings, como o usuário digita). O servidor converte depois de validar.
export const chargeFormSchema = z
  .object({
    customerId: z.string().uuid("Selecione o cliente"),
    description: z.string().trim().min(2, "Informe a descrição").max(200, "Máximo de 200 caracteres"),
    amount: z.string().trim().max(20),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Informe a data"),
    time: z.string().regex(/^\d{2}:\d{2}$/, "Informe o horário"),
    message: z.string().trim().min(1, "Escreva a mensagem").max(4000, "Máximo de 4000 caracteres"),
  })
  .superRefine((v, ctx) => {
    if (v.amount && parseMoney(v.amount) === null) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "Valor inválido. Ex.: 150,00" });
    }
    if (!v.amount && usesVariable(v.message, "valor")) {
      ctx.addIssue({ code: "custom", path: ["amount"], message: "A mensagem usa {{valor}}: informe o valor" });
    }
    const when = localToUtc(v.date, v.time);
    if (!when) {
      ctx.addIssue({ code: "custom", path: ["date"], message: "Data ou horário inválido" });
    } else if (when.getTime() < Date.now() - PAST_TOLERANCE_MS) {
      ctx.addIssue({ code: "custom", path: ["time"], message: "Escolha um horário no futuro" });
    }
  });

export type ChargeFormValues = z.infer<typeof chargeFormSchema>;
