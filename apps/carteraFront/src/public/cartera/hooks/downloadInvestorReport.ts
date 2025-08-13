import { useMutation } from "@tanstack/react-query";
import { downloadInvestorPDFService } from "../services/services";
 
export function useDownloadInvestorPDF() {
  return useMutation({
    mutationFn: async ({
      id,
      page = 1,
      perPage = 1,
    }: { id: number; page?: number; perPage?: number }) => {
      return await downloadInvestorPDFService(id, page, perPage);
    },
    onSuccess: (data, variables) => {
      const url = window.URL.createObjectURL(data);
      const a = document.createElement("a");
      a.href = url;
      a.download = `reporte_inversionista_${variables.id}.pdf`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }, 100);
    },
    onError: () => {
       
      alert("Error al descargar el PDF. Intenta de nuevo o contacta soporte.");
 
  
    },
  });
}
