import { useMutation } from "@tanstack/react-query";
import { downloadInvestorPDFService } from "../services/services";

type Vars = { id: number; page?: number; perPage?: number };

export function useDownloadInvestorPDF() {
  return useMutation({
    mutationFn: async ({ id, page = 1, perPage = 1 }: Vars) => {
      return await downloadInvestorPDFService(id, page, perPage);
    },
    onSuccess: (data) => {
      if (data?.url) {
        // Abre el PDF hospedado en R2
        window.open(data.url, "_blank");
      } else {
        alert("[ERROR] No se recibió la URL del PDF.");
      }
    },
    onError: () => {
      alert("Error al generar el PDF. Intenta de nuevo o contacta soporte.");
    },
  });
}
