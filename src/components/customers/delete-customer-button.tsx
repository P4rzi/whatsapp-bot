"use client";

import { Loader2, Trash2 } from "lucide-react";
import { useTransition } from "react";
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
import { deleteCustomerAction } from "@/modules/customers/customer.actions";

export function DeleteCustomerButton({ customerId, name }: { customerId: string; name: string }) {
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    startTransition(async () => {
      const result = await deleteCustomerAction(customerId);
      if (result && !result.ok) toast.error(result.message);
    });
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger render={<Button variant="destructive" />}>
        <Trash2 />
        Excluir
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            O cliente e todo o histórico de cobranças dele serão apagados definitivamente. Isso não pode ser desfeito.
            Se quiser só parar os envios, desative o cliente.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Voltar</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}
            Excluir definitivamente
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
