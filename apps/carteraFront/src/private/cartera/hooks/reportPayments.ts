import { useQuery } from "@tanstack/react-query";
import { getPagosConInversionistasService, type GetPagosParams, type GetPagosResponse } from "../services/services";
 

export function usePagosConInversionistas(params: GetPagosParams) {
  return useQuery<GetPagosResponse>({
    queryKey: ["pagos-inversionistas", params],
    queryFn: () => getPagosConInversionistasService(params),
    placeholderData: previousData => previousData,
  });
}
