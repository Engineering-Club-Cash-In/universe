import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  condonarMoraService,
  createMoraService,
  getCondonacionesMoraService,
  getCreditosWithMorasService,
  procesarMorasService,
  updateMoraService,
  type CondonarMoraPayload,
  type CreateMoraPayload,
  type UpdateMoraPayload,
} from "../services/services";

// 👇 importá el tipo correcto de estado
import type { EstadoCredito } from "../services/services"; 

export function useMoras(filters?: {
  numero_credito_sifco?: string;
  estado?: EstadoCredito; // 👈 corregido
  cuotas_atrasadas?: number;
}) {
  const queryClient = useQueryClient();

  const {
    data: creditosMora,
    isLoading: loadingCreditos,
    refetch: refetchCreditosMora,
  } = useQuery({
    queryKey: ["creditosMora", filters],
    queryFn: () => getCreditosWithMorasService(filters),
  });

  const {
    data: condonaciones,
    isLoading: loadingCondonaciones,
    refetch: refetchCondonaciones,
  } = useQuery({
    queryKey: ["condonacionesMora"],
    queryFn: () => getCondonacionesMoraService(),
  });

  const createMora = useMutation({
    mutationFn: (payload: CreateMoraPayload) => createMoraService(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["creditosMora"] }),
  });

  const updateMora = useMutation({
    mutationFn: (payload: UpdateMoraPayload) => updateMoraService(payload),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["creditosMora"] }),
  });

  const procesarMoras = useMutation({
    mutationFn: () => procesarMorasService(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["creditosMora"] }),
  });

  const condonarMora = useMutation({
    mutationFn: (payload: CondonarMoraPayload) => condonarMoraService(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["creditosMora"] });
      queryClient.invalidateQueries({ queryKey: ["condonacionesMora"] });
    },
  });

  return {
    creditosMora,
    condonaciones,
    loadingCreditos,
    loadingCondonaciones,
    createMora,
    updateMora,
    procesarMoras,
    condonarMora,
    refetchCreditosMora,
    refetchCondonaciones,
  };
}
