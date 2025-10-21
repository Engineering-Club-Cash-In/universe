// hooks/useInvestor.ts
import { useMutation, useQueryClient,   } from "@tanstack/react-query";
import {
  type InvestorPayload,
  insertInvestorService,
  updateInvestorService,
  getResumenInversionistas, 
  type ResumenInversionistasExcel,
} from "../services/services";

export function useInvestor() {
  const queryClient = useQueryClient();

  // 👉 Insert mutation
  const insertInvestor = useMutation({
    mutationFn: (data: InvestorPayload | InvestorPayload[]) =>
      insertInvestorService(data),
    onSuccess: () => {
      // Refresca la lista de inversionistas si existe
      queryClient.invalidateQueries({ queryKey: ["investors"] });
    },
  });

  // 👉 Update mutation
  const updateInvestor = useMutation({
    mutationFn: (data: InvestorPayload | InvestorPayload[]) =>
      updateInvestorService(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["investors"] });
    },
  });

  const resumenExcelMutation = useMutation({
    mutationFn: async (params?: { id?: number; mes?: number; anio?: number }) =>
      getResumenInversionistas({ ...params, excel: true }) as Promise<ResumenInversionistasExcel>,
  });

  return {
    insertInvestor,
    updateInvestor,
    resumenExcelMutation,
  };
}
