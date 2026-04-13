import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getCreditosEspejoPendientesService,
  completarEspejoService,
  reemplazarInversionistaCreditoService,
  getCreditCandidatesService,
  type CompletarEspejoPayload,
  type CompletarEspejoResponse,
  type ReemplazarInversionistaCreditoPayload,
  type ReemplazarInversionistaCreditoResponse,
  type SesionesPendientesPaginatedResponse,
  type OtroCreditoDisponible,
} from "../services/services";

export const sesionesPendientesKeys = {
  all: ["sesiones-pendientes"] as const,
  list: (page: number, pageSize: number, search: string) => [...sesionesPendientesKeys.all, "list", page, pageSize, search] as const,
};

export const creditCandidatesKeys = {
  all: ["credit-candidates"] as const,
};

export function useSesionesPendientes(page: number, pageSize: number, search: string) {
  return useQuery<SesionesPendientesPaginatedResponse>({
    queryKey: sesionesPendientesKeys.list(page, pageSize, search),
    queryFn: () => getCreditosEspejoPendientesService({ page, pageSize, search }),
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
    retry: 2,
    retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
  });
}

export function useCompletarEspejo() {
  const queryClient = useQueryClient();

  return useMutation<CompletarEspejoResponse, Error, CompletarEspejoPayload>({
    mutationFn: (payload) => completarEspejoService(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sesionesPendientesKeys.all });
    },
  });
}

export function useReemplazarInversionistaCredito() {
  const queryClient = useQueryClient();

  return useMutation<
    ReemplazarInversionistaCreditoResponse,
    Error,
    ReemplazarInversionistaCreditoPayload
  >({
    mutationFn: (payload) => reemplazarInversionistaCreditoService(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sesionesPendientesKeys.all });
      queryClient.invalidateQueries({ queryKey: creditCandidatesKeys.all });
    },
  });
}

export function useCreditCandidates(monto: number | null) {
  return useQuery<OtroCreditoDisponible[]>({
    queryKey: [...creditCandidatesKeys.all, monto] as const,
    queryFn: () => getCreditCandidatesService({ monto: monto! }),
    enabled: monto !== null && monto > 0,
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 5,
  });
}
