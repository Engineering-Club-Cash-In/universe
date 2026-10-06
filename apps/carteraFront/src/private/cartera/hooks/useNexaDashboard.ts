import { useQuery } from "@tanstack/react-query";
import { keepPreviousData } from "@tanstack/react-query";
import {
  getNexaDashboard,
  getNexaPagosCredito,
  type NexaDashboardParams,
  type NexaDashboardResponse,
  type NexaPagosCreditoResponse,
  type RangoFechas,
} from "../services/nexaDashboard.services";

export const useNexaDashboard = (params: NexaDashboardParams) => {
  return useQuery<NexaDashboardResponse, Error>({
    queryKey: ["nexaDashboard", params.q, params.page, params.pageSize, params.desde, params.hasta],
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
