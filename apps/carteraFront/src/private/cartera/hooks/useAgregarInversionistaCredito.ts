import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  agregarInversionistaCreditoService,
  type AgregarInversionistaCreditoPayload,
  type AgregarInversionistaCreditoResponse,
} from "../services/services";
import { investorsQueryKeys } from "./getInvestor";

export function useAgregarInversionistaCredito() {
  const queryClient = useQueryClient();

  return useMutation<
    AgregarInversionistaCreditoResponse,
    Error,
    AgregarInversionistaCreditoPayload
  >({
    mutationFn: (payload) => agregarInversionistaCreditoService(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: investorsQueryKeys.all });
    },
  });
}
