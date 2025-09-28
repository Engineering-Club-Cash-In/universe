import { useMutation } from "@tanstack/react-query";
import { type ResetCreditParams, resetCreditService } from "../services/services";
 
export function useResetCredit() {
  return useMutation({
    mutationFn: (params: ResetCreditParams) => resetCreditService(params),
  });
}