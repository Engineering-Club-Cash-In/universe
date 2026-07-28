/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/apiError";
import {
  getPagosConInversionistasService,
  pagosService,
  editPaymentService,
  type AplicarPagoResponse,
  type EditPaymentParams,
  type GetPagosParams,
  type GetPagosResponse,
} from "../services/services"; 

/**
 * 🔹 Hook que obtiene pagos con inversionistas
 * y adapta la estructura del backend al formato usado por la tabla del frontend.
 * Incluye búsqueda parcial por nombre de usuario (`usuarioNombre`).
 */
export function usePagosConInversionistas(params: GetPagosParams) {
  return useQuery<GetPagosResponse>({
    // ✅ queryKey reactiva con todos los parámetros
    queryKey: ["pagos-inversionistas", params],
    
    queryFn: async () => {
      // 🚀 El servicio ya devuelve los datos parseados y normalizados
      // No necesitamos transformar nada más aquí
      const response = await getPagosConInversionistasService(params);
      
      console.log("📊 Pagos con inversionistas:", response.data);
      console.log("💰 Totales:", response.totales);
      
      return response;
    },

    placeholderData: (previousData) => previousData,
    staleTime: 1000 * 60 * 2, // ⏳ 2 minutos
    gcTime: 1000 * 60 * 5, // 🗑️ 5 minutos en caché
    refetchOnWindowFocus: false, // ⚡ Evita refetch innecesario al cambiar de pestaña
  });
}
/**
 * 🔹 Hook para aplicar un pago al crédito y validarlo
 * Invalida automáticamente la caché de pagos con inversionistas
 */
export function useAplicarPago() {
  const queryClient = useQueryClient();

  return useMutation<AplicarPagoResponse, Error, number>({
    mutationFn: (pagoId: number) => pagosService.aplicarPago(pagoId),
    
    onSuccess: (data) => {
      // ⚠️ Estado del recálculo de recibos tras un abono a capital. Los avisos
      // que requieren acción van en toast GRANDE y persistente (no se cierra
      // solo) para que conta no los pase por alto.
      const avisoGrande = {
        duration: Infinity,
        closeButton: true,
        style: {
          width: "560px",
          maxWidth: "92vw",
          fontSize: "1.05rem",
          padding: "20px",
        },
      } as const;

      if (data.recalculo_pendientes === "error") {
        toast.error("🚨 NO SE RECALCULARON LAS CUOTAS", {
          ...avisoGrande,
          description:
            "El abono se aplicó, pero FALLÓ el recálculo de las cuotas pendientes. Corré 'Recalcular Pagos' manualmente en este crédito.",
        });
      } else if (data.recalculo_pendientes === "revisar_vencidas") {
        toast.warning("⚠️ CUOTAS VENCIDAS — NO SE RECALCULÓ", {
          ...avisoGrande,
          description:
            "El abono se aplicó, pero este crédito tiene cuotas VENCIDAS sin aplicar y el recálculo automático se omitió para no cambiarles el interés que ya se debía. Revisen con el equipo cómo tratar esas cuotas antes de correr 'Recalcular Pagos'.",
        });
      } else if (data.recalculo_pendientes === "revisar_parciales") {
        toast.warning("⚠️ PAGO PARCIAL — NO SE RECALCULÓ", {
          ...avisoGrande,
          description:
            "El abono se aplicó, pero este crédito tiene una cuota con pago PARCIAL aplicado y el recálculo automático se omitió para no reescribir ese pago. OJO: NO corras 'Recalcular Pagos' aquí sin revisarlo antes con el equipo — el botón también redistribuiría el pago parcial. Revisen el reparto de esa cuota manualmente.",
        });
      } else if (data.recalculo_pendientes === "omitido_solo_interes") {
        toast.info("Abono aplicado", {
          description:
            "Crédito solo-interés: el recálculo automático no aplica para este formato.",
        });
      }

      // 🔄 Invalidar la caché para refrescar la tabla
      queryClient.invalidateQueries({
        queryKey: ["pagos-inversionistas"]
      });

      // 📊 Log adicional si se aplicó al crédito
      if (data.applied && data.data) {
        console.log("💰 Pago aplicado al crédito:", {
          creditoId: data.data.credito_id,
          capitalNuevo: data.data.capital_nuevo,
          deudaTotalNueva: data.data.deuda_total_nueva,
        });
      }
    },

    onError: (error) => {
      // ❌ Mostrar error
      console.error("Error al aplicar pago:", error);
      alert(getApiErrorMessage(error, "Error al aplicar el pago al crédito"));
    },
  });
}

/**
 * 🔹 Hook para editar un pago (PATCH /editPayment/:id)
 */
export function useEditPayment() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ pagoId, params }: { pagoId: number; params: EditPaymentParams }) =>
      editPaymentService(pagoId, params),

    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["pagos-inversionistas"],
      });
    },
  });
}