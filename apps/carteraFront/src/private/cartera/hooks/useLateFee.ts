/* eslint-disable @typescript-eslint/no-explicit-any */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { getApiErrorMessage } from "@/lib/apiError";
import {
  condonarMoraService,
  createMoraService,
  getCondonacionesMoraService,
  getCreditosWithMorasService,
  getMoraHistorialCredito,
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
  /** false para usar el hook solo por sus mutaciones (sin disparar los listados) */
  enabled?: boolean;
  /**
   * Cada listado son 2 consultas a la base (filas + totales). Solo se pide el
   * de la pestaña que se está viendo; el otro queda dormido hasta que se
   * cambia de pestaña. Ambos por defecto en true para no romper otros usos.
   */
  enabledCreditos?: boolean;
  enabledCondonaciones?: boolean;
}

export function useMoras(options?: UseMorasOptions) {
  const queryClient = useQueryClient();
  const creditosParams = options?.creditos ?? {};
  const condonacionesParams = options?.condonaciones ?? {};
  const enabled = options?.enabled ?? true;

  const {
    data: creditosMora,
    isLoading: loadingCreditos,
    isFetching: fetchingCreditos,
    isPlaceholderData: creditosDesactualizados,
    isError: errorCreditos,
    refetch: refetchCreditosMora,
  } = useQuery({
    // los filtros y la paginación van en la key para que refresque al cambiarlos
    queryKey: ["creditosMora", creditosParams],
    queryFn: () => getCreditosWithMorasService(creditosParams),
    enabled: enabled && (options?.enabledCreditos ?? true),
    placeholderData: (prev) => prev,
  });

  const {
    data: condonaciones,
    isLoading: loadingCondonaciones,
    isFetching: fetchingCondonaciones,
    isPlaceholderData: condonacionesDesactualizadas,
    isError: errorCondonaciones,
    refetch: refetchCondonaciones,
  } = useQuery({
    queryKey: ["condonacionesMora", condonacionesParams],
    queryFn: () => getCondonacionesMoraService(condonacionesParams),
    enabled: enabled && (options?.enabledCondonaciones ?? true),
    placeholderData: (prev) => prev,
  });

  /**
   * Toda mutación que escribe en `moras_historial` tiene que refrescar el
   * historial del crédito, o el modal sigue mostrando la lista previa (sin el
   * evento —y el motivo— que se acaba de registrar).
   */
  const invalidarMoraYHistorial = () => {
    queryClient.invalidateQueries({ queryKey: ["creditosMora"] });
    queryClient.invalidateQueries({ queryKey: ["moraHistorialCredito"] });
  };

  const createMora = useMutation({
    mutationFn: (payload: CreateMoraPayload) => createMoraService(payload),
    onSuccess: invalidarMoraYHistorial,
  });

  const updateMora = useMutation({
    mutationFn: (payload: UpdateMoraPayload) => updateMoraService(payload),
    onSuccess: invalidarMoraYHistorial,
  });

  const procesarMoras = useMutation({
    mutationFn: () => procesarMorasService(),
    onSuccess: invalidarMoraYHistorial,
  });

  const condonarMora = useMutation({
    mutationFn: (payload: CondonarMoraPayload) => condonarMoraService(payload),
    onSuccess: () => {
      invalidarMoraYHistorial();
      queryClient.invalidateQueries({ queryKey: ["condonacionesMora"] });
    },
  });

  return {
    creditosMora,
    condonaciones,
    loadingCreditos,
    loadingCondonaciones,
    // `isLoading` solo es true en la PRIMERA carga: con `placeholderData` un
    // refetch por cambio de filtro/página deja datos viejos en pantalla sin
    // ninguna señal. Estas dos banderas son las que la pantalla usa para
    // marcar el contenido como desactualizado.
    fetchingCreditos,
    fetchingCondonaciones,
    creditosDesactualizados,
    condonacionesDesactualizadas,
    errorCreditos,
    errorCondonaciones,
    createMora,
    updateMora,
    procesarMoras,
    condonarMora,
    refetchCreditosMora,
    refetchCondonaciones,
  };
}

/**
 * Historial de eventos de mora de un crédito (incluye condonaciones).
 * Se usa desde el diálogo "Historial de mora" de la ficha del crédito.
 */
export function useMoraHistorialCredito(creditoId?: number | null, enabled = true) {
  return useQuery({
    queryKey: ["moraHistorialCredito", creditoId],
    queryFn: () => getMoraHistorialCredito(creditoId as number),
    enabled: enabled && !!creditoId,
    refetchOnWindowFocus: false,
  });
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
        queryClient.invalidateQueries({ queryKey: ['creditosMora'] });
        queryClient.invalidateQueries({ queryKey: ['condonacionesMora'] });
        queryClient.invalidateQueries({ queryKey: ['moraHistorialCredito'] });
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
