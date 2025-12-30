// hooks/useCuentasEmpresa.ts

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
 
import { toast } from "sonner";
import { getCuentasEmpresaService, type ActualizarCuentaPagoRequest, actualizarCuentaPagoService } from "../services/services";

// 📋 Hook para obtener todas las cuentas de empresa
export function useCuentasEmpresa() {
  return useQuery({
    queryKey: ["cuentas-empresa"],
    queryFn: getCuentasEmpresaService,
    select: (data) => data.data, // Retorna solo el array de cuentas
    staleTime: 5 * 60 * 1000, // 5 minutos
    retry: 2,
  });
}

// 🔄 Hook para actualizar cuenta de un pago
export function useActualizarCuentaPago() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: ActualizarCuentaPagoRequest) =>
      actualizarCuentaPagoService(params),

    onSuccess: (data) => {
      if (data.success) {
        toast.success("✅ Cuenta actualizada correctamente");

        // Invalidar queries relacionadas para refrescar datos
        queryClient.invalidateQueries({ queryKey: ["pagos-inversionistas"] });
        queryClient.invalidateQueries({ queryKey: ["payments"] });
      } else {
        toast.error(data.message || "❌ Error al actualizar la cuenta");
      }
    },

    onError: (error) => {
      console.error("❌ Error al actualizar cuenta:", error);
      toast.error("❌ Error al actualizar la cuenta del pago");
    },
  });
}