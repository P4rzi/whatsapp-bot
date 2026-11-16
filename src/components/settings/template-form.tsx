"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useTransition } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_MESSAGE_TEMPLATE, renderTemplate, TEMPLATE_VARIABLES } from "@/modules/messaging/template";
import { saveMessageTemplateAction } from "@/modules/settings/settings.actions";
import { messageTemplateSchema, type MessageTemplateValues } from "@/modules/settings/settings.schema";

const EXAMPLE = {
  name: "Maria Silva",
  amount: "150.00",
  description: "mensalidade de dezembro",
  scheduledAt: new Date("2026-12-10T12:00:00Z"),
};

export function TemplateForm({ initial }: { initial: string }) {
  const [pending, startTransition] = useTransition();
  const form = useForm<MessageTemplateValues>({
    resolver: zodResolver(messageTemplateSchema),
    defaultValues: { defaultMessageTemplate: initial },
  });
  const { errors } = form.formState;
  const template = useWatch({ control: form.control, name: "defaultMessageTemplate" }) ?? "";

  const onSubmit = form.handleSubmit((values) => {
    startTransition(async () => {
      const result = await saveMessageTemplateAction(values);
      if (result.ok) {
        toast.success(result.message);
        form.reset(values);
      } else {
        toast.error(result.message);
      }
    });
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
      <FieldGroup>
        <Field data-invalid={!!errors.defaultMessageTemplate}>
          <FieldLabel htmlFor="defaultMessageTemplate">Mensagem padrão</FieldLabel>
          <Textarea id="defaultMessageTemplate" rows={8} {...form.register("defaultMessageTemplate")} />
          <FieldDescription>
            Já vem preenchida em cada nova cobrança (dá para ajustar caso a caso). Variáveis:{" "}
            {TEMPLATE_VARIABLES.map((v) => `{{${v.key}}}`).join(", ")}.
          </FieldDescription>
          <FieldError errors={[errors.defaultMessageTemplate]} />
        </Field>
        <div className="flex gap-2">
          <Button type="submit" disabled={pending || !form.formState.isDirty}>
            {pending && <Loader2 className="animate-spin" />}
            Salvar mensagem
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => form.setValue("defaultMessageTemplate", DEFAULT_MESSAGE_TEMPLATE, { shouldDirty: true })}
          >
            Restaurar original
          </Button>
        </div>
      </FieldGroup>
      <div>
        <div className="mb-2 text-sm font-medium">Exemplo</div>
        <div className="rounded-lg bg-emerald-50 p-3 text-sm whitespace-pre-wrap text-emerald-950 shadow-sm dark:bg-emerald-950/40 dark:text-emerald-50">
          {renderTemplate(template, EXAMPLE)}
        </div>
      </div>
    </form>
  );
}
