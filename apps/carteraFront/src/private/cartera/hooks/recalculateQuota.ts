import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/apiError";
import { recalculateQuotaService, type RecalculateQuotaPayload } from "../services/services";

export function useRecalculateQuota() {
  return useMutation({
    mutationFn: (body: RecalculateQuotaPayload) => recalculateQuotaService(body),
    onSuccess: () => {
      toast.success("Cuota recalculada exitosamente");
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (error: any) => {
      toast.error(getApiErrorMessage(error, "Error recalculando cuota"));
    },
  });
}
