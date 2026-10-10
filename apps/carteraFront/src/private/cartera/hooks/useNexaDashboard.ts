import { useQuery, useQueryClient } from "@tanstack/react-query";
import { keepPreviousData } from "@tanstack/react-query";
import {
  getNexaDashboard,
  getNexaPagosCredito,
  getPagosNexaCredito,
  type NexaDashboardParams,
  type NexaDashboardResponse,
  type NexaPagosCreditoResponse,
  type PagosNexaCredito,
  type RangoFechas,
} from "../services/nexaDashboard.services";

export const useNexaDashboard = (params: NexaDashboardParams) => {
  return useQuery<NexaDashboardResponse, Error>({
    queryKey: ["nexaDashboard", params.q, params.page, params.pageSize, params.desde, params.hasta, params.medio, params.cuotaMes, params.asesor],
    queryFn: () => getNexaDashboard(params),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
};

export const useNexaPagosCredito = (creditoId: number | null, rango: RangoFechas) => {
  return useQuery<NexaPagosCreditoResponse, Error>({
    queryKey: ["nexaPagosCredito", creditoId, rango.desde, rango.hasta],
    queryFn: () => getNexaPagosCredito(creditoId!, rango),
    enabled: creditoId !== null,
    refetchOnWindowFocus: false,
  });
};

// Consulta, justo antes de una operación que borra los pagos del crédito, cuántos entraron por
// Nexa. Devuelve null si la consulta falla: quien llama debe advertir igual. Sin caché: es una
// decisión sobre plata, no una pantalla.
export const useConsultarPagosNexa = () => {
  const queryClient = useQueryClient();
  return async (creditoId: number): Promise<PagosNexaCredito | null> => {
    try {
      return await queryClient.fetchQuery({
        queryKey: ["pagosNexaCredito", creditoId],
        queryFn: () => getPagosNexaCredito(creditoId),
        staleTime: 0,
      });
    } catch {
      return null;
    }
  };
};
