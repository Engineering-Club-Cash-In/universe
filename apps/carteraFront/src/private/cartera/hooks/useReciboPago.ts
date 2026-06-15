import { useMutation } from "@tanstack/react-query";
import { generarReciboPago } from "../services/services";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/apiError";

export function useReciboPago() {
  return useMutation({
    mutationFn: (pagoId: number) => generarReciboPago(pagoId),
    onSuccess: (data) => {
      toast.success("Recibo generado correctamente");
      window.open(data.pdfUrl, "_blank");
    },
    onError: (err: any) => {
      toast.error(getApiErrorMessage(err, "Error al generar el recibo de pago"));
    },
  });
}
