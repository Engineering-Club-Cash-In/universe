// src/hooks/usePaymentAgreements.ts

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
 
import { toast } from "sonner";
import { 
  type GetPaymentAgreementsFilters, 
  getPaymentAgreements, 
  type CreatePaymentAgreementInput, 
  createPaymentAgreement, 
  getCreditoByNumero,
  togglePaymentAgreementStatus  // 🆕 Agregamos el import
} from "../services/services";

// 🎯 UN SOLO HOOK para todos los GET con filtros opcionales
export const usePaymentAgreements = (
  filters?: GetPaymentAgreementsFilters,
  options?: {
    enabled?: boolean;
    staleTime?: number;
    retry?: number;
  }
) => {
  return useQuery({
    queryKey: ["payment-agreements", filters], // React Query cachea por filtros
    queryFn: () => getPaymentAgreements(filters),
    enabled: options?.enabled ?? true,
    staleTime: options?.staleTime ?? 1000 * 60 * 5, // 5 minutos default
    retry: options?.retry ?? 2,
  });
};

// Hook para crear convenio
export const useCreatePaymentAgreement = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreatePaymentAgreementInput) =>
      createPaymentAgreement(input),
    onSuccess: () => {
      // Invalidar todas las queries de payment-agreements
      queryClient.invalidateQueries({ queryKey: ["payment-agreements"] });
      
      toast.success("Convenio de pago creado exitosamente");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Error al crear el convenio de pago");
    },
  });
}; 

// 🆕 Hook para activar/desactivar convenio
export const useTogglePaymentAgreementStatus = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ convenio_id, activo }: { convenio_id: number; activo: boolean }) =>
      togglePaymentAgreementStatus(convenio_id, activo),
    onSuccess: (_, variables) => {
      // Invalidar todas las queries de payment-agreements
      queryClient.invalidateQueries({ queryKey: ["payment-agreements"] });
      
      const mensaje = variables.activo 
        ? "Convenio activado exitosamente" 
        : "Convenio desactivado exitosamente";
      
      toast.success(mensaje);
    },
    onError: (error: Error) => {
      toast.error(error.message || "Error al actualizar el estado del convenio");
    },
  });
};

export const useCreditoBySifco = (numero_credito_sifco: string) => {
  return useQuery({
    queryKey: ["credito", numero_credito_sifco],
    queryFn: () => getCreditoByNumero(numero_credito_sifco),
    enabled: !!numero_credito_sifco, // Solo ejecutar si hay sifco
    staleTime: 1000 * 60 * 5, // 5 minutos
    retry: 2,
  });
};