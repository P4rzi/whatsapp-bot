"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useTransition } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { ActionResult } from "@/lib/action-result";
import { createCustomerAction, updateCustomerAction } from "@/modules/customers/customer.actions";
import {
  CONSENT_SOURCES,
  customerFormSchema,
  emptyCustomerForm,
  type CustomerFormValues,
} from "@/modules/customers/customer.schema";

type Props = { customerId?: string; defaultValues?: CustomerFormValues };

export function CustomerForm({ customerId, defaultValues }: Props) {
  const [pending, startTransition] = useTransition();
  const form = useForm<CustomerFormValues>({
    resolver: zodResolver(customerFormSchema),
    defaultValues: defaultValues ?? emptyCustomerForm,
  });
  const { errors } = form.formState;
  const consent = useWatch({ control: form.control, name: "consent" });

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result: ActionResult | undefined = customerId
        ? await updateCustomerAction(customerId, values)
        : await createCustomerAction(values);
      if (!result) return; // redirecionou
      if (!result.ok) {
        for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(field as keyof CustomerFormValues, { message });
        }
        toast.error(result.message);
      } else {
        toast.success(result.message ?? "Salvo.");
        form.reset(values);
      }
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="max-w-xl">
      <FieldGroup>
        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="name">Nome</FieldLabel>
          <Input id="name" autoComplete="off" aria-invalid={!!errors.name} {...form.register("name")} />
          <FieldError errors={[errors.name]} />
        </Field>

        <Field data-invalid={!!errors.phone}>
          <FieldLabel htmlFor="phone">Telefone (WhatsApp)</FieldLabel>
          <Input
            id="phone"
            inputMode="tel"
            placeholder="(11) 98765-4321"
            aria-invalid={!!errors.phone}
            {...form.register("phone")}
          />
          <FieldDescription>Com DDD. Números de outros países: inclua o código do país.</FieldDescription>
          <FieldError errors={[errors.phone]} />
        </Field>

        <Field data-invalid={!!errors.notes}>
          <FieldLabel htmlFor="notes">Observações (opcional)</FieldLabel>
          <Textarea id="notes" rows={3} {...form.register("notes")} />
          <FieldError errors={[errors.notes]} />
        </Field>

        <Controller
          control={form.control}
          name="isActive"
          render={({ field }) => (
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="isActive">Cliente ativo</FieldLabel>
                <FieldDescription>Clientes inativos não recebem mensagens.</FieldDescription>
              </FieldContent>
              <Switch id="isActive" checked={field.value} onCheckedChange={field.onChange} />
            </Field>
          )}
        />

        <Controller
          control={form.control}
          name="consent"
          render={({ field }) => (
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="consent">Autorizou receber mensagens</FieldLabel>
                <FieldDescription>
                  LGPD: sem autorização registrada, nenhuma cobrança é enviada para este cliente.
                </FieldDescription>
              </FieldContent>
              <Switch id="consent" checked={field.value} onCheckedChange={field.onChange} />
            </Field>
          )}
        />

        {consent && (
          <Field data-invalid={!!errors.consentSource}>
            <FieldLabel htmlFor="consentSource">Como autorizou</FieldLabel>
            <NativeSelect id="consentSource" aria-invalid={!!errors.consentSource} {...form.register("consentSource")}>
              <option value="">Selecione…</option>
              {CONSENT_SOURCES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </NativeSelect>
            <FieldError errors={[errors.consentSource]} />
          </Field>
        )}

        <Controller
          control={form.control}
          name="optedOut"
          render={({ field }) => (
            <Field orientation="horizontal">
              <FieldContent>
                <FieldLabel htmlFor="optedOut">Pediu para não receber mais</FieldLabel>
                <FieldDescription>Descadastro: bloqueia todos os envios para este cliente.</FieldDescription>
              </FieldContent>
              <Switch id="optedOut" checked={field.value} onCheckedChange={field.onChange} />
            </Field>
          )}
        />

        <div>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            {customerId ? "Salvar alterações" : "Cadastrar cliente"}
          </Button>
        </div>
      </FieldGroup>
    </form>
  );
}
