import { useMutation } from "@tanstack/react-query";
import { getReporteNoLiquidados } from "../services/services";

export function useDownloadReporteNoLiquidados() {
  return useMutation({
    mutationFn: async (investorId: number) => {
      return await getReporteNoLiquidados(investorId);
    },
    onSuccess: (data) => {
      if (data?.url) {
        window.open(data.url, "_blank");
      } else {
        alert("No se recibió la URL del reporte.");
      }
    },
    onError: () => {
      alert("Error al generar el reporte. Intenta de nuevo o contacta soporte.");
    },
  });
}
