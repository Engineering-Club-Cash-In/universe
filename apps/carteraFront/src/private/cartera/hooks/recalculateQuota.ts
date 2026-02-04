import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { recalculateQuotaService, type RecalculateQuotaPayload } from "../services/services";

export function useRecalculateQuota() {
  return useMutation({
    mutationFn: (body: RecalculateQuotaPayload) => recalculateQuotaService(body),
    onSuccess: () => {
      toast.success("Cuota recalculada exitosamente");
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (error: any) => {
      const msg = error?.response?.data?.message || "Error recalculando cuota";
      toast.error(msg);
    },
  });
}
