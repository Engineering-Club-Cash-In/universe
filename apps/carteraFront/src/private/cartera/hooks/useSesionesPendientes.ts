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
} from "../services/services";

export const sesionesPendientesKeys = {
  all: ["sesiones-pendientes"] as const,
  list: () => [...sesionesPendientesKeys.all, "list"] as const,
  candidates: () => [...sesionesPendientesKeys.all, "candidates"] as const,
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

export function useCreditCandidates() {
  return useQuery({
    queryKey: sesionesPendientesKeys.candidates(),
    queryFn: () => getCreditCandidatesService(10),
    staleTime: 0, // siempre fresco
    gcTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
    retry: 2,
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
    },
  });
}
