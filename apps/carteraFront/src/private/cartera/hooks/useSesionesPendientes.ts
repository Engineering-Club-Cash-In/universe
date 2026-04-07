import { useQuery } from "@tanstack/react-query";
import { getCreditosEspejoPendientesService } from "../services/services";

export const sesionesPendientesKeys = {
  all: ["sesiones-pendientes"] as const,
  list: () => [...sesionesPendientesKeys.all, "list"] as const,
};

export function useSesionesPendientes() {
  return useQuery({
    queryKey: sesionesPendientesKeys.list(),
    queryFn: getCreditosEspejoPendientesService,
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });
}
