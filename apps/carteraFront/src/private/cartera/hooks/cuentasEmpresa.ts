import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  actualizarCuentaEmpresaService,
  crearCuentaEmpresaService,
  crearMovimientoCuentaEmpresaService,
  eliminarCuentaEmpresaService,
  getCuentasEmpresaService,
  getMovimientosByCuentaService,
  type ActualizarCuentaPayload,
  type CrearCuentaPayload,
  type CrearMovimientoPayload,
  type ListarCuentasParams,
  type ListarMovimientosParams,
} from "../services/services";

// Prefijo de la queryKey. invalidateQueries con este key matchea por prefijo
// → invalida también ["cuentas-empresa", { filters }] sin importar el filtro.
const KEY_CUENTAS = ["cuentas-empresa"] as const;

// Construye un mensaje de error legible juntando lo que devuelve el backend
// (message + error). Útil cuando el toast genérico no es suficiente.
function readableError(res: { message?: string; error?: string }, fallback: string) {
  const parts = [res.message, res.error].filter(Boolean) as string[];
  return parts.length > 0 ? parts.join(" — ") : fallback;
}

// Helpers para invalidar y refetchar de inmediato (no espera al refocus).
async function refrescarCuentas(qc: ReturnType<typeof useQueryClient>) {
  await qc.invalidateQueries({ queryKey: KEY_CUENTAS });
  await qc.refetchQueries({ queryKey: KEY_CUENTAS, type: "active" });
}

const KEY_MOVIMIENTOS = ["cuentas-empresa-movimientos"] as const;

// Lista los movimientos de una cuenta. Se refetchea automáticamente cuando
// se invalida la key (ej: tras crear un nuevo movimiento).
export function useMovimientosCuenta(
  cuentaId: number | null,
  filters?: ListarMovimientosParams
) {
  return useQuery({
    queryKey: [...KEY_MOVIMIENTOS, cuentaId, filters ?? null],
    queryFn: () => getMovimientosByCuentaService(cuentaId!, filters),
    select: (res) => res.data,
    enabled: !!cuentaId,
    staleTime: 30 * 1000,
  });
}

export function useCuentasEmpresa(filters?: ListarCuentasParams) {
  return useQuery({
    queryKey: [...KEY_CUENTAS, filters ?? null],
    queryFn: () => getCuentasEmpresaService(filters),
    select: (res) => res.data,
    staleTime: 30 * 1000,
  });
}

export function useCrearCuentaEmpresa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CrearCuentaPayload) => crearCuentaEmpresaService(payload),
    onSuccess: async (res) => {
      if (!res.success) {
        toast.error(readableError(res, "Error al crear la cuenta"));
        return;
      }
      toast.success("Cuenta creada");
      await refrescarCuentas(qc);
    },
    onError: (err: any) => {
      console.error("crearCuenta:", err);
      toast.error(err?.message ?? "Error al crear la cuenta");
    },
  });
}

export function useActualizarCuentaEmpresa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { cuentaId: number; payload: ActualizarCuentaPayload }) =>
      actualizarCuentaEmpresaService(vars.cuentaId, vars.payload),
    onSuccess: async (res) => {
      if (!res.success) {
        toast.error(readableError(res, "Error al actualizar la cuenta"));
        return;
      }
      toast.success("Cuenta actualizada");
      await refrescarCuentas(qc);
    },
    onError: (err: any) => {
      console.error("actualizarCuenta:", err);
      toast.error(err?.message ?? "Error al actualizar la cuenta");
    },
  });
}

export function useEliminarCuentaEmpresa() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (cuentaId: number) => eliminarCuentaEmpresaService(cuentaId),
    onSuccess: async (res) => {
      if (!res.success) {
        toast.error(readableError(res, "Error al desactivar la cuenta"));
        return;
      }
      toast.success("Cuenta desactivada");
      await refrescarCuentas(qc);
    },
    onError: (err: any) => {
      console.error("eliminarCuenta:", err);
      toast.error(err?.message ?? "Error al desactivar la cuenta");
    },
  });
}

export function useCrearMovimientoCuenta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { cuentaId: number; payload: CrearMovimientoPayload }) =>
      crearMovimientoCuentaEmpresaService(vars.cuentaId, vars.payload),
    onSuccess: async (res) => {
      if (!res.success) {
        // Mostrá el motivo real del backend (ej: trigger DB raised exception)
        toast.error(readableError(res, "Error al registrar el movimiento"));
        return;
      }
      toast.success("Movimiento registrado");
      // Refrescar lista de cuentas (saldo) y la lista de movimientos abierta
      await refrescarCuentas(qc);
      await qc.invalidateQueries({ queryKey: KEY_MOVIMIENTOS });
    },
    onError: (err: any) => {
      console.error("crearMovimiento:", err);
      toast.error(err?.message ?? "Error al registrar el movimiento");
    },
  });
}
