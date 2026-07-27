/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
      // ⚠️ Estado del recálculo de recibos tras un abono a capital: si quedó
      // pendiente, operaciones debe correr "Recalcular Pagos" a mano.
      if (data.recalculo_pendientes === "error") {
        alert(
          "El abono se aplicó, pero FALLÓ el recálculo de las cuotas pendientes. Corré 'Recalcular Pagos' manualmente en este crédito."
        );
      } else if (data.recalculo_pendientes === "revisar_pendientes_validacion") {
        alert(
          "El abono se aplicó y se recalcularon las cuotas pendientes, pero hay pagos registrados SIN validar que quedaron fuera: después de validarlos, corré 'Recalcular Pagos' manualmente."
        );
      } else if (data.recalculo_pendientes === "revisar_parciales") {
        alert(
          "El abono se aplicó, pero este crédito tiene una cuota con pago PARCIAL aplicado: el recálculo automático se omitió para no reescribir su historial. Corré 'Recalcular Pagos' manualmente en este crédito."
        );
      } else if (data.recalculo_pendientes === "omitido_solo_interes") {
        alert(
          "Abono aplicado. Crédito solo-interés: el recálculo automático no aplica para este formato."
        );
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