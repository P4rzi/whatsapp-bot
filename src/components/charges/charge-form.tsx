"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRef, useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { localToUtc } from "@/lib/utils/datetime";
import { parseMoney } from "@/lib/utils/money";
import { formatPhone } from "@/lib/utils/phone";
import { createChargeAction, updateChargeAction } from "@/modules/charges/charge.actions";
import { chargeFormSchema, type ChargeFormValues } from "@/modules/charges/charge.schema";
import { renderTemplate, TEMPLATE_VARIABLES } from "@/modules/messaging/template";

type CustomerOption = { id: string; name: string; phone: string; hasConsent: boolean };

type Props = {
  customers: CustomerOption[];
  defaultCustomerId?: string;
  defaultMessage: string;
  defaultDate: string;
  defaultTime: string;
  /** Edição: id da cobrança e valores atuais. */
  chargeId?: string;
  initialValues?: Omit<ChargeFormValues, "customerId"> & { customerId: string };
};

export function ChargeForm({
  customers,
  defaultCustomerId,
  defaultMessage,
  defaultDate,
  defaultTime,
  chargeId,
  initialValues,
}: Props) {
  const [pending, startTransition] = useTransition();
  const messageRef = useRef<HTMLTextAreaElement | null>(null);
  const form = useForm<ChargeFormValues>({
    resolver: zodResolver(chargeFormSchema),
    defaultValues: initialValues ?? {
      customerId: defaultCustomerId ?? "",
      description: "",
      amount: "",
      date: defaultDate,
      time: defaultTime,
      message: defaultMessage,
    },
  });
  const { errors } = form.formState;
  const values = useWatch({ control: form.control });
  const customer = customers.find((c) => c.id === values.customerId);

  const preview = renderTemplate(values.message ?? "", {
    name: customer?.name ?? "Nome do cliente",
    amount: parseMoney(values.amount) ?? null,
    description: values.description || "descrição",
    scheduledAt: localToUtc(values.date ?? "", values.time ?? "") ?? new Date(),
  });

  function insertVariable(key: string) {
    const el = messageRef.current;
    const token = `{{${key}}}`;
    const current = form.getValues("message");
    const start = el?.selectionStart ?? current.length;
    const end = el?.selectionEnd ?? current.length;
    form.setValue("message", current.slice(0, start) + token + current.slice(end), { shouldDirty: true });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  }

  const onSubmit = form.handleSubmit((data) => {
    startTransition(async () => {
      const result = chargeId ? await updateChargeAction(chargeId, data) : await createChargeAction(data);
      if (!result) return; // redirecionou
      if (!result.ok) {
        for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
          form.setError(field as keyof ChargeFormValues, { message });
        }
        toast.error(result.message);
      }
    });
  });

  const messageField = form.register("message");

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
      <FieldGroup>
        <Field data-invalid={!!errors.customerId}>
          <FieldLabel htmlFor="customerId">Cliente</FieldLabel>
          <NativeSelect id="customerId" aria-invalid={!!errors.customerId} {...form.register("customerId")}>
            <option value="">Selecione…</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} · {formatPhone(c.phone)}
                {c.hasConsent ? "" : " (sem autorização)"}
              </option>
            ))}
          </NativeSelect>
          {customer && !customer.hasConsent && (
            <FieldDescription className="text-amber-700 dark:text-amber-300">
              Este cliente ainda não tem autorização registrada. Registre no cadastro dele antes de agendar.
            </FieldDescription>
          )}
          <FieldError errors={[errors.customerId]} />
        </Field>

        <Field data-invalid={!!errors.description}>
          <FieldLabel htmlFor="description">Descrição</FieldLabel>
          <Input id="description" placeholder="Mensalidade de dezembro" {...form.register("description")} />
          <FieldError errors={[errors.description]} />
        </Field>

        <Field data-invalid={!!errors.amount}>
          <FieldLabel htmlFor="amount">Valor (opcional)</FieldLabel>
          <Input id="amount" inputMode="decimal" placeholder="150,00" {...form.register("amount")} />
          <FieldError errors={[errors.amount]} />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field data-invalid={!!errors.date}>
            <FieldLabel htmlFor="date">Data do envio</FieldLabel>
            <Input id="date" type="date" {...form.register("date")} />
            <FieldError errors={[errors.date]} />
          </Field>
          <Field data-invalid={!!errors.time}>
            <FieldLabel htmlFor="time">Horário</FieldLabel>
            <Input id="time" type="time" {...form.register("time")} />
            <FieldError errors={[errors.time]} />
          </Field>
        </div>
        <FieldDescription className="-mt-4">Horário de Brasília.</FieldDescription>

        <Field data-invalid={!!errors.message}>
          <FieldLabel htmlFor="message">Mensagem</FieldLabel>
          <div className="flex flex-wrap gap-1.5">
            {TEMPLATE_VARIABLES.map((v) => (
              <Button key={v.key} type="button" variant="outline" size="xs" title={v.label} onClick={() => insertVariable(v.key)}>
                {`{{${v.key}}}`}
              </Button>
            ))}
          </div>
          <Textarea
            id="message"
            rows={8}
            {...messageField}
            ref={(el) => {
              messageField.ref(el);
              messageRef.current = el;
            }}
          />
          <FieldError errors={[errors.message]} />
        </Field>

        <div>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            {chargeId ? "Salvar alterações" : "Agendar cobrança"}
          </Button>
        </div>
      </FieldGroup>

      <Card className="h-fit lg:sticky lg:top-20">
        <CardHeader>
          <CardTitle>Prévia</CardTitle>
          <CardDescription>Exatamente o texto que será enviado.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-lg bg-emerald-50 p-3 text-sm whitespace-pre-wrap text-emerald-950 shadow-sm dark:bg-emerald-950/40 dark:text-emerald-50">
            {preview || <span className="text-muted-foreground">A mensagem aparece aqui.</span>}
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
