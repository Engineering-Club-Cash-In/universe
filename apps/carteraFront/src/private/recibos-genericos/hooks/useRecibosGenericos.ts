import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getRecibosGenericosService,
  createReciboGenericoService,
  updateReciboGenericoService,
  deleteReciboGenericoService,
  getReciboGenericoPdfService,
  type CreateReciboGenericoPayload,
  type UpdateReciboGenericoPayload,
} from "../services/services";

const QUERY_KEY = "recibos-genericos";

export function useRecibosGenericos(params?: {
  fecha_desde?: string;
  fecha_hasta?: string;
}) {
  return useQuery({
    queryKey: [QUERY_KEY, params?.fecha_desde, params?.fecha_hasta],
    queryFn: () => getRecibosGenericosService(params),
    staleTime: 1000 * 60,
  });
}

export function useCreateReciboGenerico() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateReciboGenericoPayload) =>
      createReciboGenericoService(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });
}

export function useUpdateReciboGenerico() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: number; payload: UpdateReciboGenericoPayload }) =>
      updateReciboGenericoService(id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });
}

export function useDeleteReciboGenerico() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteReciboGenericoService(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] });
    },
  });
}

export function useReciboGenericoPdf() {
  return useMutation({
    mutationFn: (id: number) => getReciboGenericoPdfService(id),
  });
}
