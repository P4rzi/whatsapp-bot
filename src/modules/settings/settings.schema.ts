import { z } from "zod";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";

export const passwordChangeSchema = z
  .object({
    currentPassword: z.string().min(1, "Informe a senha atual").max(200),
    newPassword: z
      .string()
      .min(PASSWORD_MIN_LENGTH, `A nova senha precisa ter pelo menos ${PASSWORD_MIN_LENGTH} caracteres`)
      .max(200),
    confirmPassword: z.string(),
  })
  .refine((v) => v.newPassword === v.confirmPassword, { path: ["confirmPassword"], message: "As senhas não conferem" })
  .refine((v) => v.newPassword !== v.currentPassword, { path: ["newPassword"], message: "A nova senha deve ser diferente da atual" });

export type PasswordChangeValues = z.infer<typeof passwordChangeSchema>;

export const messageTemplateSchema = z.object({
  defaultMessageTemplate: z.string().trim().min(1, "Escreva a mensagem").max(4000, "Máximo de 4000 caracteres"),
});

export type MessageTemplateValues = z.infer<typeof messageTemplateSchema>;
