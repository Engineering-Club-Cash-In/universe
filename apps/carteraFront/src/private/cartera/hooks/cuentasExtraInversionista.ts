import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  actualizarCuentaExtraService,
  crearCuentaExtraService,
  eliminarCuentaExtraService,
  getCuentasExtraByInversionistaService,
  listarCuentasExtraService,
  type ActualizarCuentaExtraPayload,
  type CrearCuentaExtraPayload,
  type ListarCuentasExtraParams,
} from "../services/services";

const KEY_CUENTAS_EXTRA = ["cuentas-extra-inversionista"] as const;

function readableError(
  res: { message?: string; error?: string },
  fallback: string
) {
  const parts = [res.message, res.error].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(" — ") : fallback;
}

async function refrescarCuentasExtra(qc: ReturnType<typeof useQueryClient>) {
  await qc.invalidateQueries({ queryKey: KEY_CUENTAS_EXTRA });
  await qc.refetchQueries({ queryKey: KEY_CUENTAS_EXTRA, type: "active" });
}

export function useCuentasExtra(filters?: ListarCuentasExtraParams) {
  return useQuery({
    queryKey: [...KEY_CUENTAS_EXTRA, filters ?? null],
    queryFn: () => listarCuentasExtraService(filters),
    select: (res) => res.data,
    staleTime: 30 * 1000,
  });
}

export function useCuentasExtraPorInversionista(inversionistaId: number | null) {
  return useQuery({
    queryKey: [...KEY_CUENTAS_EXTRA, "por-inversionista", inversionistaId],
    queryFn: () => getCuentasExtraByInversionistaService(inversionistaId!),
    select: (res) => res.data,
    enabled: !!inversionistaId,
    staleTime: 30 * 1000,
  });
}

export function useCrearCuentaExtra() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CrearCuentaExtraPayload) =>
      crearCuentaExtraService(payload),
    onSuccess: async (res) => {
      if (!res.success) {
        toast.error(readableError(res, "Error al crear la cuenta extra"));
        return;
      }
      toast.success("Cuenta extra creada");
      await refrescarCuentasExtra(qc);
    },
    onError: (err: any) => {
      console.error("crearCuentaExtra:", err);
      toast.error(err?.message ?? "Error al crear la cuenta extra");
    },
  });
}

export function useActualizarCuentaExtra() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      cuentaExtraId: number;
      payload: ActualizarCuentaExtraPayload;
    }) => actualizarCuentaExtraService(vars.cuentaExtraId, vars.payload),
    onSuccess: async (res) => {
      if (!res.success) {
        toast.error(readableError(res, "Error al actualizar la cuenta extra"));
        return;
      }
      toast.success("Cuenta extra actualizada");
      await refrescarCuentasExtra(qc);
    },
    onError: (err: any) => {
      console.error("actualizarCuentaExtra:", err);
      toast.error(err?.message ?? "Error al actualizar la cuenta extra");
    },
  });
}

export function useEliminarCuentaExtra() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cuentaExtraId: number) =>
      eliminarCuentaExtraService(cuentaExtraId),
    onSuccess: async (res) => {
      if (!res.success) {
        toast.error(readableError(res, "Error al eliminar la cuenta extra"));
        return;
      }
      toast.success("Cuenta extra eliminada");
      await refrescarCuentasExtra(qc);
    },
    onError: (err: any) => {
      console.error("eliminarCuentaExtra:", err);
      toast.error(err?.message ?? "Error al eliminar la cuenta extra");
    },
  });
}
