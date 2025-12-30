// src/hooks/useLiquidateByInvestor.ts
import { useMutation } from "@tanstack/react-query";
import { liquidateByInvestorService, type LiquidateByInvestorRequest, type LiquidateByInvestorResponse } from "../services/services";
 
 

/**
 * Hook para liquidar todos los pagos de un inversionista.
 * Devuelve el método mutate y los estados del proceso.
 */
export function useLiquidateByInvestor() {
  return useMutation<
    LiquidateByInvestorResponse, 
    Error, 
    LiquidateByInvestorRequest | void // 🆕 void = sin parámetros
  >({
    mutationFn: (data) => liquidateByInvestorService(data!),
  });
}