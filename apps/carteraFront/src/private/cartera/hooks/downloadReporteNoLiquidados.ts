import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { getReporteNoLiquidados } from "../services/services";
import { getApiErrorMessage } from "@/lib/apiError";

export function useDownloadReporteNoLiquidados() {
  return useMutation({
    mutationFn: async (investorId: number) => {
      return await getReporteNoLiquidados(investorId);
    },
    onSuccess: (data) => {
      if (data?.url) {
        window.open(data.url, "_blank");
      } else {
        toast.error("No se recibió la URL del reporte");
      }
    },
    onError: (err) => {
      toast.error(getApiErrorMessage(err, "Error al generar el reporte"));
    },
  });
}
