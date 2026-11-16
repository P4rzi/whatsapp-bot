import { z } from "zod";
import { normalizePhone } from "@/lib/utils/phone";

export const CONSENT_SOURCES = ["WhatsApp", "Contrato", "Verbal", "Formulário", "Outro"] as const;

// Formato do formulário (mesmo schema no navegador e no servidor).
export const customerFormSchema = z
  .object({
    name: z.string().trim().min(2, "Informe o nome").max(120, "Nome muito longo"),
    phone: z
      .string()
      .trim()
      .min(1, "Informe o telefone")
      .refine((v) => normalizePhone(v) !== null, "Telefone inválido. Use DDD + número, ex.: (11) 98765-4321"),
    notes: z.string().trim().max(2000, "Máximo de 2000 caracteres"),
    isActive: z.boolean(),
    consent: z.boolean(),
    consentSource: z.string().trim().max(60),
    optedOut: z.boolean(),
  })
  .refine((v) => !v.consent || v.consentSource.length > 0, {
    path: ["consentSource"],
    message: "Informe como o cliente autorizou",
  });

export type CustomerFormValues = z.infer<typeof customerFormSchema>;

export const emptyCustomerForm: CustomerFormValues = {
  name: "",
  phone: "",
  notes: "",
  isActive: true,
  consent: false,
  consentSource: "",
  optedOut: false,
};
