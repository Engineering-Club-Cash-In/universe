import { useQuery } from "@tanstack/react-query";
import {
  getSimulacionInversionista,
  type SimulacionInversionistaResponse,
} from "../services/services";

export const useSimulacionInversionista = (
  inversionista_id: number | null,
  enabled: boolean,
  mesLiquidacion?: { mes: number; anio: number }
) => {
  return useQuery<SimulacionInversionistaResponse, Error>({
    queryKey: ["simulacionInversionista", inversionista_id, mesLiquidacion],
    queryFn: async () => {
      const response = await getSimulacionInversionista(inversionista_id!, mesLiquidacion);
      if (!response.success) throw new Error("Error al obtener simulación del inversionista");
      return response;
    },
    enabled: enabled && inversionista_id !== null,
    refetchOnWindowFocus: false,
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });
};
