import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Informe um e-mail válido").max(200),
  password: z.string().min(1, "Informe a senha").max(200),
});

export type LoginInput = z.input<typeof loginSchema>;
