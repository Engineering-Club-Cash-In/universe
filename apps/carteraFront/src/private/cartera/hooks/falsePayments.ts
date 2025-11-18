/* eslint-disable @typescript-eslint/no-explicit-any */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { falsePaymentService, generateFalsePaymentsService, type FalsePaymentPayload, type FalsePaymentResponse, type GenerateFalsePaymentsParams } from "../services/services";
 

export function useFalsePayment() {
  return useMutation<FalsePaymentResponse, Error, FalsePaymentPayload>({
    mutationFn: falsePaymentService,
  });
}
/**
 * 🎣 Hook para generar pagos falsos
 * 
 * @example
 * const { mutate, isLoading } = useFalsePayments();
 * 
 * // Usar en un componente
 * const handleGenerar = () => {
 *   mutate({
 *     inversionistaId: 123,
 *     generateFalsePayment: true
 *   });
 * };
 */
export function useFalsePayments() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (params: GenerateFalsePaymentsParams) => 
      generateFalsePaymentsService(params),
    
    onSuccess: (data) => {
      if (data.success) {
        // ✅ Éxito
        alert(`${data.message}: ${data.totalCreditosConPagos} créditos procesados`);

        // Invalidar queries relacionadas si es necesario
        queryClient.invalidateQueries({ queryKey: ["pagos-inversionistas"] });
      } else {
        // ❌ Error del servidor
        alert(`Error al procesar pagos: `);
      }
    },
    
      onError: (error: any) => {
        // ❌ Error de red o cliente
        console.error("Error en mutación:", error);
        alert("Error al procesar pagos: Hubo un problema al conectar con el servidor");
      },
    });
  }