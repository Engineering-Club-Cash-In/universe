import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner"; // o donde uses tu toast
import { updateCreditService, type UpdateCreditBody } from "../services/services";

// Sin onError acá: el único consumidor (ModalEditCredit) ya pasa el suyo en
// mutate(), y TanStack Query ejecuta AMBOS onError (el del hook y el de la
// llamada) — con los dos definidos salían dos toasts apilados por el mismo
// error, tapándose entre sí. El de ModalEditCredit lee directo
// error?.response?.data?.message, así que es el que queda.
export function useUpdateCredit() {
  return useMutation({
    mutationFn: (body: UpdateCreditBody) => updateCreditService(body),
    onSuccess: () => {
      toast.success("Crédito actualizado exitosamente");
    },
  });
}
