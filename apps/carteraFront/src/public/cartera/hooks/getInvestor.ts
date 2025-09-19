import { useQuery } from "@tanstack/react-query";
import { getInvestorServices } from "../services/services";
 

export interface UseGetInvestorsParams {
  id?: number;       // Optional: para filtrar por un inversionista específico
  page?: number;
  perPage?: number;
}

/**
 * Hook para obtener inversionistas con resumenes y subtotales (paginado).
 * @param params { id, page, perPage }
 * @returns { data, isLoading, isError, error, ... }
 */
export function useGetInvestors(params: UseGetInvestorsParams = {}) {
  return useQuery({
    queryKey: [
      "inversionistas-todo",
      params.id ?? null,
      params.page ?? 1,
      params.perPage ?? 10,
    ],
    queryFn: () => getInvestorServices(params),
 
  });
}