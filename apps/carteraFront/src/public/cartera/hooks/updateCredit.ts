import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner"; // o donde uses tu toast
import { updateCreditService, type UpdateCreditBody } from "../services/services";

export function useUpdateCredit() {
  return useMutation({
    mutationFn: (body: UpdateCreditBody) => updateCreditService(body),
    onSuccess: () => {
      toast.success("Crédito actualizado exitosamente");
      alert("Crédito actualizado exitosamente");
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (error: any) => {
      const msg = error?.response?.data?.message || "Error actualizando crédito";
      toast.error(msg);
      alert(msg);
    },
  });
}
