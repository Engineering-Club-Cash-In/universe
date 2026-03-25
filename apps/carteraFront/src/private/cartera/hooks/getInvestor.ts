/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getInvestorServices,
  getInvestorTotalsService,
  calcularPagosEspejoService,
  getInvestorMirrorSummaryService,
  type InvestorMirrorSummaryResponse,
  liquidateByInvestorService,
  downloadInvestorPDFService,
  recalcularPagosEspejoService,
  reversePagosEspejoService,
  asignarReinversionService,
  type RecalcularPagoPayload,
  type LiquidateByInvestorRequest,
  type LiquidateByInvestorResponse,
  type AsignarReinversionPayload,
  type AsignarReinversionResponse,
} from "../services/services";

// ============================================
// 🔑 QUERY KEYS CENTRALIZADAS
// ============================================
export const investorsQueryKeys = {
  all: ['investors'] as const,
  lists: () => [...investorsQueryKeys.all, 'list'] as const,
  list: (params: UseGetInvestorsParams) => [
    ...investorsQueryKeys.lists(), 
    params
  ] as const,
  detail: (id: number) => [...investorsQueryKeys.all, 'detail', id] as const,
};
// ============================================
// 📊 TYPES
// ============================================
// 🎣 HOOK
export interface UseGetInvestorsParams {
  id?: number;
  dpi?: string; // 🆕
  page?: number;
  perPage?: number;
  numeroCreditoSifco?: string; // 🆕
  nombreUsuario?: string; // 🆕
  incluirLiquidados?: boolean; // 🆕
  numeroCuota?: number; // 🆕
  tipo?: "originales" | "espejos" | "ambas"; // 🆕 NUEVO: Permite consultar originales, espejos o ambas
}

interface DownloadPDFVars {
  id: number;
  page?: number;
  perPage?: number;
}

/**
 * Hook para obtener inversionistas con resumenes y subtotales (paginado).
 * @param params { id, dpi, page, perPage, numeroCreditoSifco, nombreUsuario, incluirLiquidados, numeroCuota }
 * @returns { data, isLoading, isError, error, refetch, isFetching }
 * 
 * @example
 * // Buscar por ID
 * useGetInvestors({ id: 9, page: 1, perPage: 10 })
 * 
 * @example
 * // Buscar por DPI
 * useGetInvestors({ dpi: "1234567890123" })
 * 
 * @example
 * // Incluir pagos liquidados
 * useGetInvestors({ id: 9, incluirLiquidados: true })
 * 
 * @example
 * // Filtrar por cuota específica
 * useGetInvestors({ id: 9, numeroCuota: 5 })
 * 
 * @example
 * // Búsqueda con múltiples filtros
 * useGetInvestors({ 
 *   id: 9, 
 *   numeroCreditoSifco: "01010214111160",
 *   nombreUsuario: "Juan",
 *   incluirLiquidados: false,
 *   page: 1,
 *   perPage: 20
 * })
 */
export function useGetInvestors(params: UseGetInvestorsParams = {}) {
  return useQuery({
    queryKey: investorsQueryKeys.list(params), // 🆕 Ahora incluye todos los parámetros
    queryFn: () => getInvestorServices(params),
    
    // ⏱️ Configuración de cache
    staleTime: 1000 * 60 * 2, // 2 minutos
    gcTime: 1000 * 60 * 5, // 5 minutos
    
    // 🔄 Refetch automático
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    
    // 🎯 Retry
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    
    // ✅ Placeholder data
    placeholderData: (previousData) => previousData,
    
    // 🆕 Solo hacer query si hay al menos id o dpi
    enabled: !!(params.id || params.dpi),
  });
}

/**
 * 🆕 NUEVO HOOK: Obtiene los totales globales de un inversionista (sin paginación)
 * Calcula las sumas de TODOS los créditos y pagos del inversionista
 * 
 * @param params { id, dpi, tipo, incluirLiquidados, numeroCuota }
 * @returns { data, isLoading, isError, error, refetch }
 * 
 * @example
 * // Obtener totales globales de un inversionista
 * const { data: totales } = useGetInvestorTotals({ id: 2, tipo: "espejos" })
 * console.log(totales?.totales.total_monto_aportado)
 */
export function useGetInvestorTotals(params: UseGetInvestorsParams = {}) {
  return useQuery({
    queryKey: ['investor-totals', params],
    queryFn: () => getInvestorTotalsService(params),
    
    // ⏱️ Configuración de cache
    staleTime: 1000 * 60 * 2, // 2 minutos
    gcTime: 1000 * 60 * 5, // 5 minutos
    
    // 🔄 Refetch automático
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    
    // 🎯 Retry
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
    
    // ✅ Placeholder data
    placeholderData: (previousData) => previousData,
    
    // 🆕 Solo hacer query si hay al menos id o dpi
    enabled: !!(params.id || params.dpi),
  });
}

 

// ============================================
// 💰 MUTATIONS
// ============================================

/**
 * Hook para liquidar todos los pagos de un inversionista.
 * Invalida automáticamente las queries de inversionistas después de liquidar.
 */
export function useLiquidateByInvestor() {
  const queryClient = useQueryClient();
  
  return useMutation<
    LiquidateByInvestorResponse, 
    Error, 
    LiquidateByInvestorRequest,
    { previousData: [any, any][] }
  >({
    mutationFn: (data) => liquidateByInvestorService(data),
    
    onMutate: async (variables) => {
      // 🎯 Cancela queries en progreso
      await queryClient.cancelQueries({ 
        queryKey: investorsQueryKeys.lists() 
      });

      // 📸 Snapshot del estado anterior
      const previousData = queryClient.getQueriesData({ 
        queryKey: investorsQueryKeys.lists() 
      });

      console.log("💰 Liquidando inversionista:", variables.inversionista_id);

      return { previousData };
    },
    
    onSuccess: (  variables) => {
      console.log("✅ Inversionista liquidado:", variables.inversionista_id);
      
      // 🔄 Invalida todas las listas de inversionistas
      queryClient.invalidateQueries({ 
        queryKey: investorsQueryKeys.lists() 
      });
    },
    
    onError: (error) => {
      console.error("❌ Error al liquidar inversionista:", error);
      
      // 🔙 Rollback: restaura data anterior si falla
     
      
      alert("Error al liquidar el inversionista. Por favor intenta de nuevo.");
    },
  });
}

/**
 * Hook para descargar PDF del reporte del inversionista.
 * Abre el PDF en nueva pestaña automáticamente.
 */
export function useDownloadInvestorPDF() {
  return useMutation({
    mutationFn: async ({ id, page = 1, perPage = 10 }: DownloadPDFVars) => {
      return await downloadInvestorPDFService(id, page, perPage);
    },
    
    onSuccess: (data, variables) => {
      console.log("✅ PDF generado para inversionista:", variables.id);
      
      if (data?.url) {
        // Abre el PDF hospedado en R2
        window.open(data.url, "_blank");
      } else {
        console.error("❌ No se recibió la URL del PDF");
        alert("Error: No se recibió la URL del PDF.");
      }
    },
    
    onError: (error, variables) => {
      console.error("❌ Error al generar PDF para inversionista:", variables.id, error);
      alert("Error al generar el PDF. Intenta de nuevo o contacta soporte.");
    },
  });
}

/**
 * 🎨 Hook auxiliar para prefetch (opcional, pero útil).
 * Carga data de inversionistas antes de que se necesite.
 * 
 * Ejemplo de uso:
 * const prefetchInvestors = usePrefetchInvestors();
 * prefetchInvestors({ page: 2, perPage: 10 }); // Carga página 2 en background
 */
export function usePrefetchInvestors() {
  const queryClient = useQueryClient();
  
  return (params: UseGetInvestorsParams) => {
    queryClient.prefetchQuery({
      queryKey: investorsQueryKeys.list(params),
      queryFn: () => getInvestorServices(params),
      staleTime: 1000 * 60 * 2,
    });
  };
}

/**
 * 🗑️ Hook auxiliar para limpiar cache de inversionistas (opcional).
 * Útil si querés forzar un refetch completo.
 */
export function useInvalidateInvestors() {
  const queryClient = useQueryClient();
  
  return () => {
    queryClient.invalidateQueries({ 
      queryKey: investorsQueryKeys.all 
    });
  };
}

// ============================================================
// 🧙 useGetInvestorMirrorSummary
// ============================================================
export function useGetInvestorMirrorSummary(
  params: { id?: number; dpi?: string; incluirLiquidados?: boolean },
  enabled: boolean = false
) {
  return useQuery<InvestorMirrorSummaryResponse>({
    queryKey: ["investor-mirror-summary", params],
    queryFn: () => getInvestorMirrorSummaryService(params),
    staleTime: 0,
    gcTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
    retry: 1,
    enabled: enabled && !!(params.id || params.dpi),
  });
}

// ============================================================
// 🚀 useCalcularPagosEspejo
// ============================================================
export function useCalcularPagosEspejo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (inversionistaId: number) =>
      calcularPagosEspejoService(inversionistaId),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: investorsQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ["investor-mirror-summary"] });
    },
    onError: (error: Error) => console.error("❌ Error en calcularPagosEspejo:", error),
  });
}

// ============================================================
// 💾 useRecalcularPagosEspejo (Guardar cambios manuales)
// ============================================================
export function useRecalcularPagosEspejo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (pagos: RecalcularPagoPayload[]) =>
      recalcularPagosEspejoService(pagos),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: investorsQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ["investor-mirror-summary"] });
    },
    onError: (error: Error) => console.error("❌ Error en recalcularPagosEspejo:", error),
  });
}

// ============================================================
// 🔄 useReversePagosEspejo (Revertir/Eliminar pagos espejo generados)
// ============================================================
export function useReversePagosEspejo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (inversionistaId: number) =>
      reversePagosEspejoService(inversionistaId),

    onSuccess: (data) => {
      console.log("✅ Pagos revertidos:", data);
      queryClient.invalidateQueries({ queryKey: investorsQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ["investor-mirror-summary"] });
      queryClient.invalidateQueries({ queryKey: ["investor-totals"] });
    },
    onError: (error: Error) => {
      console.error("❌ Error revirtiendo pagos:", error);
    },
  });
}

// ============================================================
// useAsignarReinversion
// ============================================================
export function useAsignarReinversion() {
  const queryClient = useQueryClient();

  return useMutation<AsignarReinversionResponse, Error, AsignarReinversionPayload>({
    mutationFn: (payload) => asignarReinversionService(payload),

    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: investorsQueryKeys.lists() });
      queryClient.invalidateQueries({ queryKey: ["investor-mirror-summary"] });
      queryClient.invalidateQueries({ queryKey: ["investor-totals"] });
    },
    onError: (error: Error) => {
      console.error("Error asignando reinversión:", error);
    },
  });
}