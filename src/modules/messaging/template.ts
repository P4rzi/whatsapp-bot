import { formatInTz } from "@/lib/utils/datetime";
import { formatMoney } from "@/lib/utils/money";

// Modelo de mensagem com variáveis. Usado na prévia (navegador) e no envio (worker),
// para que o texto mostrado seja exatamente o que será enviado.

export const TEMPLATE_VARIABLES = [
  { key: "nome", label: "Nome do cliente" },
  { key: "valor", label: "Valor (ex.: 150,00)" },
  { key: "descricao", label: "Descrição da cobrança" },
  { key: "data", label: "Data agendada (dd/mm/aaaa)" },
] as const;

export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number]["key"];

export const DEFAULT_MESSAGE_TEMPLATE = `Olá, {{nome}}!

Passando para lembrar sobre a cobrança referente a {{descricao}}, no valor de R$ {{valor}}.

Caso já tenha realizado o pagamento, por favor, desconsidere esta mensagem.`;

export type TemplateContext = {
  name: string;
  /** String decimal ("150.00") ou null. */
  amount: string | null;
  description: string;
  scheduledAt: Date;
};

const VARIABLE_RE = /\{\{\s*(nome|valor|descricao|data)\s*\}\}/gi;

export function renderTemplate(template: string, ctx: TemplateContext): string {
  return template.replace(VARIABLE_RE, (_, key: string) => {
    switch (key.toLowerCase() as TemplateVariable) {
      case "nome":
        return ctx.name.trim();
      case "valor":
        return formatMoney(ctx.amount);
      case "descricao":
        return ctx.description.trim();
      case "data":
        return formatInTz(ctx.scheduledAt, "dd/MM/yyyy");
    }
  });
}

export function usesVariable(template: string, variable: TemplateVariable): boolean {
  return new RegExp(`\\{\\{\\s*${variable}\\s*\\}\\}`, "i").test(template);
}
