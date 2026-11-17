"use client";

import { Check, CheckCheck, Loader2, UserX } from "lucide-react";
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
import type { ActionResult } from "@/lib/action-result";
import { markAllInboundHandledAction, markInboundHandledAction, optOutFromInboundAction } from "@/modules/inbound/inbound.actions";

function useAction() {
  const [pending, startTransition] = useTransition();
  const run = (fn: () => Promise<ActionResult>, onOk?: () => void) =>
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        if (result.message) toast.success(result.message);
        onOk?.();
      } else toast.error(result.message);
    });
  return { pending, run };
}

export function MarkHandledButton({ id }: { id: string }) {
  const { pending, run } = useAction();
  return (
    <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => markInboundHandledAction(id))}>
      {pending ? <Loader2 className="animate-spin" /> : <Check />}
      Marcar como vista
    </Button>
  );
}

export function MarkAllHandledButton() {
  const { pending, run } = useAction();
  return (
    <Button variant="outline" disabled={pending} onClick={() => run(() => markAllInboundHandledAction())}>
      {pending ? <Loader2 className="animate-spin" /> : <CheckCheck />}
      Marcar todas como vistas
    </Button>
  );
}

/** Descadastrar a pedido do cliente (com confirmação). */
export function OptOutButton({ customerId, name }: { customerId: string; name: string }) {
  const [open, setOpen] = useState(false);
  const { pending, run } = useAction();
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger render={<Button variant="ghost" size="sm" className="text-destructive" />}>
        <UserX />
        Descadastrar
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Descadastrar {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            O cliente para de receber mensagens e as cobranças ainda agendadas para ele são canceladas. Dá para
            desfazer depois no cadastro do cliente (as cobranças canceladas precisam ser criadas de novo).
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={pending}
            onClick={() => run(() => optOutFromInboundAction(customerId), () => setOpen(false))}
          >
            {pending && <Loader2 className="animate-spin" />}
            Descadastrar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
