import { useQuery } from "@tanstack/react-query";
import {
  getCapitalInversionistas,
  type CapitalInversionistasParams,
  type CapitalInversionistasResponse,
} from "../services/services";

export const useCapitalInversionistas = (
  params: CapitalInversionistasParams,
  enabled: boolean
) => {
  return useQuery<CapitalInversionistasResponse, Error>({
    queryKey: [
      "capitalInversionistas",
      params.fecha_desde,
      params.fecha_hasta,
    ],
    queryFn: async () => {
      const response = await getCapitalInversionistas(params);
      if (!response.success) throw new Error("Error al obtener capital de inversionistas");
      return response;
    },
    enabled,
    refetchOnWindowFocus: false,
    staleTime: 1000 * 60 * 5,
    retry: 1,
  });
};
