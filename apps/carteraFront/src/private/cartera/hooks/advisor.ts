/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  type Advisor,
  getAdvisors,
  createAdvisor,
  updateAdvisor,
  // Conta
  createContaServiceFrontend,
  updateContaServiceFrontend,
  getPlatformUsersServiceFrontend,
  type ContaPayload,
  type ContaUpdatePayload,
  type PlatformUser,
  // Inversionistas
  getInvestors,
  insertInvestorService,
  updateInvestorService,
  type InvestorPayload,
  type InvestorResponse,
  // Créditos
  createCredit,
  updateCreditService,
  type CreditFormValues,
  type UpdateCreditBody,
  // Pagos
  createPago,
  getPagosByMesAnio,
  type PagosPorMesAnioResponse,
} from "../services/services";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { PagoFormValues } from "./registerPayment";
import { toast } from "sonner"; // 🔥 O tu librería de toast preferida
import { getApiErrorMessage } from "@/lib/apiError";

// ========== Hook ==========
// 🚀 Administración de asesores, contadores, inversionistas, créditos y pagos
export const useAdminData = () => {
  const queryClient = useQueryClient();

  // ====== ASESORES ======
  const { 
    data: advisors = [], 
    isLoading: loadingAdvisors,
    error: advisorsError,
    refetch: refetchAdvisors 
  } = useQuery<Advisor[]>({
    queryKey: ["advisors"],
    queryFn: getAdvisors,
    staleTime: 5 * 60 * 1000, // 5 minutos
  });

  const addAdvisorMutation = useMutation({
    mutationFn: (advisor: Partial<Advisor> & { password?: string }) => createAdvisor(advisor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["advisors"] });
      toast.success("✅ Asesor creado exitosamente");
    },
    onError: (error: any) => {
      console.error("Error creando asesor:", error);
      toast.error(getApiErrorMessage(error, "❌ Error al crear asesor"));
    },
  });

  const editAdvisorMutation = useMutation({
    mutationFn: ({ id, advisor }: { id: number; advisor: Partial<Advisor> & { password?: string } }) =>
      updateAdvisor(id, advisor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["advisors"] });
      queryClient.invalidateQueries({ queryKey: ["platformUsers"] });
      toast.success("✅ Asesor actualizado exitosamente");
    },
    onError: (error: any) => {
      console.error("Error actualizando asesor:", error);
      toast.error(getApiErrorMessage(error, "❌ Error al actualizar asesor"));
    },
  });

  // ====== CONTA USERS ======
  const { 
    data: platformUsers = [], 
    isLoading: loadingPlatformUsers,
    error: platformUsersError,
    refetch: refetchPlatformUsers 
  } = useQuery<PlatformUser[]>({
    queryKey: ["platformUsers"],
    queryFn: getPlatformUsersServiceFrontend,
    staleTime: 5 * 60 * 1000,
  });

  const addContaMutation = useMutation({
    mutationFn: (data: ContaPayload) => createContaServiceFrontend(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platformUsers"] });
      toast.success("✅ Contador creado exitosamente");
    },
    onError: (error: any) => {
      console.error("Error creando contador:", error);
      toast.error(getApiErrorMessage(error, "❌ Error al crear contador"));
    },
  });

  const editContaMutation = useMutation({
    mutationFn: ({ contaId, updates }: { contaId: number; updates: ContaUpdatePayload }) =>
      updateContaServiceFrontend(contaId, updates),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["platformUsers"] });
      toast.success("✅ Contador actualizado exitosamente");
    },
    onError: (error: any) => {
      console.error("Error actualizando contador:", error);
      toast.error(getApiErrorMessage(error, "❌ Error al actualizar contador"));
    },
  });

  // ====== INVERSIONISTAS ======
  const { 
    data: investors = [], 
    isLoading: loadingInvestors,
    error: investorsError,
    refetch: refetchInvestors 
  } = useQuery<InvestorResponse[]>({
    queryKey: ["investors"],
    queryFn: getInvestors,
    staleTime: 5 * 60 * 1000,
  });

  const addInvestorMutation = useMutation({
    mutationFn: (investor: InvestorPayload | InvestorPayload[]) => insertInvestorService(investor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["investors"] });
      toast.success("✅ Inversionista creado/actualizado exitosamente");
    },
    onError: (error: any) => {
      console.error("Error con inversionista:", error);
      toast.error(getApiErrorMessage(error, "❌ Error al procesar inversionista"));
    },
  });

  const editInvestorMutation = useMutation({
    mutationFn: (investor: InvestorPayload | InvestorPayload[]) => updateInvestorService(investor),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["investors"] });
      toast.success("✅ Inversionista actualizado exitosamente");
    },
    onError: (error: any) => {
      console.error("Error actualizando inversionista:", error);
      toast.error(getApiErrorMessage(error, "❌ Error al actualizar inversionista"));
    },
  });

  // ====== CRÉDITOS ======
  const addCreditMutation = useMutation({
    mutationFn: (credit: CreditFormValues) => createCredit(credit),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["credits"] });
      toast.success("✅ Crédito creado exitosamente");
    },
    onError: (error: any) => {
      console.error("Error creando crédito:", error);
      toast.error(getApiErrorMessage(error, "❌ Error al crear crédito"));
    },
  });

  const editCreditMutation = useMutation({
    mutationFn: (body: UpdateCreditBody) => updateCreditService(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["credits"] });
      toast.success("✅ Crédito actualizado exitosamente");
    },
    onError: (error: any) => {
      console.error("Error actualizando crédito:", error);
      toast.error(getApiErrorMessage(error, "❌ Error al actualizar crédito"));
    },
  });

  // ====== PAGOS ======
  const { 
    data: pagosPorMesAnio, 
    isLoading: loadingPagos,
    error: pagosError,
    refetch: refetchPagos 
  } = useQuery<PagosPorMesAnioResponse>({
    queryKey: ["pagosPorMesAnio", new Date().getMonth() + 1, new Date().getFullYear()],
    queryFn: () => getPagosByMesAnio({ 
      mes: new Date().getMonth() + 1, 
      anio: new Date().getFullYear() 
    }),
    staleTime: 2 * 60 * 1000, // 2 minutos para pagos (más reciente)
  });

  const addPagoMutation = useMutation({
    mutationFn: (pago: PagoFormValues) => createPago(pago),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["pagos"] });
      queryClient.invalidateQueries({ queryKey: ["pagosPorMesAnio"] });
      toast.success("✅ Pago registrado exitosamente");
    },
    onError: (error: any) => {
      console.error("Error registrando pago:", error);
      toast.error(getApiErrorMessage(error, "❌ Error al registrar pago"));
    },
  });

  // ====== MÉTODOS ======
  return {
    // Asesores
    advisors,
    loadingAdvisors,
    advisorsError,
    refetchAdvisors,
    addAdvisor: addAdvisorMutation.mutateAsync,
    addAdvisorMutation, // 🔥 Exponer mutación completa para acceder a isPending, etc.
    editAdvisor: editAdvisorMutation.mutateAsync,
    editAdvisorMutation,

    // Conta
    platformUsers,
    loadingPlatformUsers,
    platformUsersError,
    refetchPlatformUsers,
    addConta: addContaMutation.mutateAsync,
    addContaMutation,
    editConta: editContaMutation.mutateAsync,
    editContaMutation,

    // Inversionistas
    investors,
    loadingInvestors,
    investorsError,
    refetchInvestors,
    addInvestor: addInvestorMutation.mutateAsync,
    addInvestorMutation,
    editInvestor: editInvestorMutation.mutateAsync,
    editInvestorMutation,

    // Créditos
    addCredit: addCreditMutation.mutateAsync,
    addCreditMutation,
    editCredit: editCreditMutation.mutateAsync,
    editCreditMutation,

    // Pagos
    pagosPorMesAnio,
    loadingPagos,
    pagosError,
    refetchPagos,
    addPago: addPagoMutation.mutateAsync,
    addPagoMutation,
  };
};