// 📄 src/hooks/useCreditosPorAsesor.ts
import { useQuery } from "@tanstack/react-query"; 
import { getCreditosPorAsesorService, type AsesorResumen } from "../services/services";

/**
 * 🧠 Hook: useCreditosPorAsesor
 * -----------------------------
 * Hook personalizado para obtener los créditos agrupados por asesor,
 * con manejo automático de cache, recarga y estado de error.
 *
 * @param numero_credito_sifco (opcional) Filtra por número de crédito SIFCO
 * @returns data, isLoading, isError, refetch
 */
export const useCreditosPorAsesor = (numero_credito_sifco?: string) => {
  return useQuery<AsesorResumen[], Error>({
    queryKey: ["creditosPorAsesor", numero_credito_sifco],
    queryFn: async () => {
      const response = await getCreditosPorAsesorService(numero_credito_sifco);
      if (!response.success) throw new Error(response.message);
      return response.data;
    },
    refetchOnWindowFocus: false,  // Evita recargar al cambiar de pestaña
    staleTime: 1000 * 60 * 5,     // Cache por 5 minutos
    retry: 1,                     // Solo un reintento si falla
  });
};