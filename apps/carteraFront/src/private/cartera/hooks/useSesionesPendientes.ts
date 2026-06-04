import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getCreditosEspejoPendientesService,
  completarEspejoService,
  reemplazarInversionistaCreditoService,
  getCreditCandidatesService,
  devolverPendientesACubeService,
  compraCarteraAceptadaService,
  extenderCompraCarteraService,
  type CompletarEspejoPayload,
  type CompletarEspejoResponse,
  type ReemplazarInversionistaCreditoPayload,
  type ReemplazarInversionistaCreditoResponse,
  type SesionesPendientesPaginatedResponse,
  type OtroCreditoDisponible,
  type DevolverPendientesACubePayload,
  type DevolverPendientesACubeResponse,
  type CompraCarteraAceptadaPayload,
  type CompraCarteraAceptadaResponse,
  type ExtenderCompraCarteraPayload,
  type ExtenderCompraCarteraResponse,
} from "../services/services";

export const sesionesPendientesKeys = {
  all: ["sesiones-pendientes"] as const,
  list: (page: number, pageSize: number, search: string, statuses?: string) => 
    [...sesionesPendientesKeys.all, "list", page, pageSize, search, statuses] as const,
};

export const creditCandidatesKeys = {
  all: ["credit-candidates"] as const,
};

export function useSesionesPendientes(page: number, pageSize: number, search: string, statuses?: string) {
  return useQuery<SesionesPendientesPaginatedResponse>({
    queryKey: sesionesPendientesKeys.list(page, pageSize, search, statuses),
    queryFn: () => getCreditosEspejoPendientesService({ page, pageSize, search, statuses }),
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

export function useCreditCandidates(monto: number | null, inversionista_id?: number) {
  return useQuery<OtroCreditoDisponible[]>({
    queryKey: [...creditCandidatesKeys.all, monto, inversionista_id] as const,
    queryFn: () => getCreditCandidatesService({ monto: monto!, inversionista_id }),
    enabled: monto !== null && monto > 0,
    staleTime: 1000 * 60 * 2,
    gcTime: 1000 * 60 * 5,
  });
}

export function useDevolverPendientesACube() {
  const queryClient = useQueryClient();

  return useMutation<
    DevolverPendientesACubeResponse,
    Error,
    DevolverPendientesACubePayload
  >({
    mutationFn: (payload) => devolverPendientesACubeService(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sesionesPendientesKeys.all });
    },
  });
}

export function useCompraCarteraAceptada() {
  const queryClient = useQueryClient();

  return useMutation<
    CompraCarteraAceptadaResponse,
    Error,
    CompraCarteraAceptadaPayload
  >({
    mutationFn: (payload) => compraCarteraAceptadaService(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sesionesPendientesKeys.all });
    },
  });
}

export function useExtenderCompraCartera() {
  const queryClient = useQueryClient();

  return useMutation<
    ExtenderCompraCarteraResponse,
    Error,
    ExtenderCompraCarteraPayload
  >({
    mutationFn: (payload) => extenderCompraCarteraService(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: sesionesPendientesKeys.all });
    },
  });
}
