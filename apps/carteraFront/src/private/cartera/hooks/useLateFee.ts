/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/apiError";
import {
  condonarMoraService,
  createMoraService,
  getCondonacionesMoraService,
  getCreditosWithMorasService,
  morasService,
  procesarMorasService,
  updateMoraService,
  type CondonacionesMoraParams,
  type CondonarMoraPayload,
  type CreateMoraPayload,
  type CreditosConMoraParams,
  type UpdateMoraPayload,
} from "../services/services";

import type { CondonarMasivaRequest } from "../services/services";

export interface UseMorasOptions {
  /** Filtros + paginación de la pestaña "Créditos con Mora" */
  creditos?: CreditosConMoraParams;
  /** Filtros + paginación de la pestaña "Condonaciones" */
  condonaciones?: CondonacionesMoraParams;
}

export function useMoras(options?: UseMorasOptions) {
  const queryClient = useQueryClient();
  const creditosParams = options?.creditos ?? {};
  const condonacionesParams = options?.condonaciones ?? {};

  const {
    data: creditosMora,
    isLoading: loadingCreditos,
    refetch: refetchCreditosMora,
  } = useQuery({
    // la paginación va en la key para que refresque al cambiar de página
    queryKey: ["creditosMora", creditosParams],
    queryFn: () => getCreditosWithMorasService(creditosParams),
  });

  const {
    data: condonaciones,
    isLoading: loadingCondonaciones,
    refetch: refetchCondonaciones,
  } = useQuery({
    queryKey: ["condonacionesMora", condonacionesParams],
    queryFn: () => getCondonacionesMoraService(condonacionesParams),
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

export const useMorasMasivo = () => {
  const queryClient = useQueryClient();

  /**
   * Condonar moras masivamente
   */
  const condonarMorasMasivo = useMutation({
    mutationFn: (data: CondonarMasivaRequest) => morasService.condonarMorasMasivo(data),
    onSuccess: (data) => {
      if (data.success) {
        toast.success(data.message, {
          description: `${data.condonados} créditos afectados`,
        });
        // Invalida queries relacionadas para refetch automático
        queryClient.invalidateQueries({ queryKey: ['creditos'] });
        queryClient.invalidateQueries({ queryKey: ['moras'] });
        queryClient.invalidateQueries({ queryKey: ['condonaciones'] });
      } else {
        toast.error(data.message);
      }
    },
    onError: (error: any) => {
      toast.error(getApiErrorMessage(error, 'Error en condonación masiva'));
    },
  });

  return {
    condonarMorasMasivo,
  };
};