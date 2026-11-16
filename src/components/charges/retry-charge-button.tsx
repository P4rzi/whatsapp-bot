"use client";

import { Loader2, RotateCcw } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { retryChargeAction } from "@/modules/charges/charge.actions";

/** Reenviar uma cobrança que falhou. Se o resultado foi desconhecido, avisa do risco de duplicar. */
export function RetryChargeButton({ chargeId, unknownResult }: { chargeId: string; unknownResult: boolean }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const result = await retryChargeAction(chargeId);
      if (result.ok) {
        toast.success(result.message ?? "Reenvio agendado.");
        setOpen(false);
      } else {
        toast.error(result.message);
      }
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" />}>
        <RotateCcw />
        Reenviar
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Reenviar esta cobrança?</AlertDialogTitle>
          <AlertDialogDescription>
            {unknownResult
              ? "Não foi possível confirmar se a mensagem anterior chegou. Confira a conversa com o cliente no WhatsApp: se a mensagem já estiver lá, reenviar vai duplicá-la."
              : "A mensagem volta para a fila e é enviada no próximo ciclo, se o WhatsApp estiver conectado."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            {unknownResult ? "Conferi, reenviar" : "Reenviar"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
