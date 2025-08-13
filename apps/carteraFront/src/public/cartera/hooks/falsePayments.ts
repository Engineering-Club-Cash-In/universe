import { useMutation } from "@tanstack/react-query";
import { falsePaymentService, type FalsePaymentPayload, type FalsePaymentResponse } from "../services/services";
 

export function useFalsePayment() {
  return useMutation<FalsePaymentResponse, Error, FalsePaymentPayload>({
    mutationFn: falsePaymentService,
  });
}