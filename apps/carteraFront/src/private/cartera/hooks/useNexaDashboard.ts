import { useQuery } from "@tanstack/react-query";
import { keepPreviousData } from "@tanstack/react-query";
import {
  getNexaDashboard,
  getNexaPagosCredito,
  type NexaDashboardParams,
  type NexaDashboardResponse,
  type NexaPagosCreditoResponse,
} from "../services/nexaDashboard.services";

export const useNexaDashboard = (params: NexaDashboardParams) => {
  return useQuery<NexaDashboardResponse, Error>({
    queryKey: ["nexaDashboard", params.q, params.page, params.pageSize],
    queryFn: () => getNexaDashboard(params),
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: false,
    staleTime: 60_000,
  });
};

export const useNexaPagosCredito = (creditoId: number | null) => {
  return useQuery<NexaPagosCreditoResponse, Error>({
    queryKey: ["nexaPagosCredito", creditoId],
    queryFn: () => getNexaPagosCredito(creditoId!),
    enabled: creditoId !== null,
    refetchOnWindowFocus: false,
  });
};
