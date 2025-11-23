/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { 
  getInvestorServices,
  liquidateByInvestorService,
  downloadInvestorPDFService,
  type LiquidateByInvestorRequest,
  type LiquidateByInvestorResponse,
} from "../services/services";

// ============================================
// 🔑 QUERY KEYS CENTRALIZADAS
// ============================================
export const investorsQueryKeys = {
  all: ["inversionistas"] as const,
  lists: () => [...investorsQueryKeys.all, "list"] as const,
  list: (params: UseGetInvestorsParams) => 
    [...investorsQueryKeys.lists(), params] as const,
  detail: (id: number) => [...investorsQueryKeys.all, "detail", id] as const,
};

// ============================================
// 📊 TYPES
// ============================================
export interface UseGetInvestorsParams {
  id?: number;
  page?: number;
  perPage?: number;
}

type DownloadPDFVars = { 
  id: number; 
  page?: number; 
  perPage?: number;
};

// ============================================
// 🔍 QUERIES
// ============================================

/**
 * Hook para obtener inversionistas con resumenes y subtotales (paginado).
 * @param params { id, page, perPage }
 * @returns { data, isLoading, isError, error, refetch, isFetching }
 */
export function useGetInvestors(params: UseGetInvestorsParams = {}) {
  return useQuery({
    queryKey: investorsQueryKeys.list(params),
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
    
    onSuccess: (data, variables) => {
      console.log("✅ Inversionista liquidado:", variables.inversionista_id);
      
      // 🔄 Invalida todas las listas de inversionistas
      queryClient.invalidateQueries({ 
        queryKey: investorsQueryKeys.lists() 
      });
    },
    
    onError: (error, variables, context) => {
      console.error("❌ Error al liquidar inversionista:", error);
      
      // 🔙 Rollback: restaura data anterior si falla
      if (context?.previousData) {
        context.previousData.forEach(([key, data]) => {
          queryClient.setQueryData(key, data);
        });
      }
      
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