"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useTransition } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";
import { changePasswordAction } from "@/modules/settings/settings.actions";
import { passwordChangeSchema, type PasswordChangeValues } from "@/modules/settings/settings.schema";

export function PasswordForm() {
  const [pending, startTransition] = useTransition();
  const form = useForm<PasswordChangeValues>({
    resolver: zodResolver(passwordChangeSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await changePasswordAction(values);
      if (result.ok) {
        toast.success(result.message);
        form.reset();
      } else {
        for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(field as keyof PasswordChangeValues, { message });
        }
        toast.error(result.message);
      }
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-sm">
      <FieldGroup>
        <Field data-invalid={!!errors.currentPassword}>
          <FieldLabel htmlFor="currentPassword">Senha atual</FieldLabel>
          <Input id="currentPassword" type="password" autoComplete="current-password" {...form.register("currentPassword")} />
          <FieldError errors={[errors.currentPassword]} />
        </Field>
        <Field data-invalid={!!errors.newPassword}>
          <FieldLabel htmlFor="newPassword">Nova senha</FieldLabel>
          <Input id="newPassword" type="password" autoComplete="new-password" {...form.register("newPassword")} />
          <FieldDescription>Mínimo de {PASSWORD_MIN_LENGTH} caracteres. Uma frase longa é mais segura e fácil de lembrar.</FieldDescription>
          <FieldError errors={[errors.newPassword]} />
        </Field>
        <Field data-invalid={!!errors.confirmPassword}>
          <FieldLabel htmlFor="confirmPassword">Repita a nova senha</FieldLabel>
          <Input id="confirmPassword" type="password" autoComplete="new-password" {...form.register("confirmPassword")} />
          <FieldError errors={[errors.confirmPassword]} />
        </Field>
        <div>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            Alterar senha
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
