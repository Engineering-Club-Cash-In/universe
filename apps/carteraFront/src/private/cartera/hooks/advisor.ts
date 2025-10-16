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

// ========== Hook ==========
// 🚀 Administración de asesores, contadores, inversionistas, créditos y pagos
export const useAdminData = () => {
  const queryClient = useQueryClient();

  // ====== ASESORS ======
  const { data: advisors = [], isLoading: loadingAdvisors } = useQuery<Advisor[]>({
    queryKey: ["advisors"],
    queryFn: getAdvisors,
  });

  const addAdvisorMutation = useMutation({
    mutationFn: (advisor: Partial<Advisor> & { password?: string }) => createAdvisor(advisor),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["advisors"] }),
  });

  const editAdvisorMutation = useMutation({
  mutationFn: ({ id, advisor }: { id: number; advisor: Partial<Advisor> & { password?: string } }) =>
    updateAdvisor(id, advisor),
  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["advisors"] });
    queryClient.invalidateQueries({ queryKey: ["platformUsers"] }); // 👈 refresca la tabla
  },
});


  // ====== CONTA USERS ======
  const { data: platformUsers = [], isLoading: loadingPlatformUsers } = useQuery<PlatformUser[]>({
    queryKey: ["platformUsers"],
    queryFn: getPlatformUsersServiceFrontend,
  });

  const addContaMutation = useMutation({
    mutationFn: (data: ContaPayload) => createContaServiceFrontend(data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["platformUsers"] }),
  });

  const editContaMutation = useMutation({
    mutationFn: ({ contaId, updates }: { contaId: number; updates: ContaUpdatePayload }) =>
      updateContaServiceFrontend(contaId, updates),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["platformUsers"] }),
  });

  // ====== INVERSIONISTAS ======
  const { data: investors = [], isLoading: loadingInvestors } = useQuery<InvestorResponse[]>({
    queryKey: ["investors"],
    queryFn: getInvestors,
  });

  const addInvestorMutation = useMutation({
    mutationFn: (investor: InvestorPayload | InvestorPayload[]) => insertInvestorService(investor),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["investors"] }),
  });

  const editInvestorMutation = useMutation({
    mutationFn: (investor: InvestorPayload | InvestorPayload[]) => updateInvestorService(investor),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["investors"] }),
  });

  // ====== CRÉDITOS ======
  const addCreditMutation = useMutation({
    mutationFn: (credit: CreditFormValues) => createCredit(credit),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["credits"] }),
  });

  const editCreditMutation = useMutation({
    mutationFn: (body: UpdateCreditBody) => updateCreditService(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["credits"] }),
  });

  // ====== PAGOS ======
  const addPagoMutation = useMutation({
    mutationFn: (pago: PagoFormValues) => createPago(pago),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["pagos"] }),
  });

  const { data: pagosPorMesAnio, isLoading: loadingPagos } = useQuery<PagosPorMesAnioResponse>({
    queryKey: ["pagosPorMesAnio"],
    queryFn: () => getPagosByMesAnio({ mes: new Date().getMonth() + 1, anio: new Date().getFullYear() }),
  });

  // ====== MÉTODOS ======
  return {
    // asesores
    advisors,
    loadingAdvisors,
    addAdvisor: addAdvisorMutation.mutateAsync,
    editAdvisor: editAdvisorMutation.mutateAsync,

    // conta
    platformUsers,
    loadingPlatformUsers,
    addConta: addContaMutation.mutateAsync,
    editConta: editContaMutation.mutateAsync,

    // inversionistas
    investors,
    loadingInvestors,
    addInvestor: addInvestorMutation.mutateAsync,
    editInvestor: editInvestorMutation.mutateAsync,

    // créditos
    addCredit: addCreditMutation.mutateAsync,
    editCredit: editCreditMutation.mutateAsync,

    // pagos
    pagosPorMesAnio,
    loadingPagos,
    addPago: addPagoMutation.mutateAsync,
  };
};
