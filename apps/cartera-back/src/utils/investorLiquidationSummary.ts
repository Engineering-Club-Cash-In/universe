export type EstadoLiquidacionResumen =
  | "pending"
  | "uploaded"
  | "liquidated"
  | "sin_movimiento";

export type EstadoLiquidacionResumenFilter =
  | "pending"
  | "uploaded"
  | "liquidated"
  | "all";

interface ResumenLiquidacionDecisionInput {
  requestedEstado: EstadoLiquidacionResumenFilter;
  hasNoLiquidado: boolean;
  hasLiquidado: boolean;
  hasBoletaPendiente: boolean;
}

export function resolveEstadoLiquidacionResumen({
  requestedEstado,
  hasNoLiquidado,
  hasLiquidado,
  hasBoletaPendiente,
}: ResumenLiquidacionDecisionInput): EstadoLiquidacionResumen | null {
  if (requestedEstado === "pending") {
    return hasNoLiquidado && !hasBoletaPendiente ? "pending" : null;
  }

  if (requestedEstado === "uploaded") {
    return hasNoLiquidado && hasBoletaPendiente ? "uploaded" : null;
  }

  if (requestedEstado === "liquidated") {
    return !hasNoLiquidado && hasLiquidado ? "liquidated" : null;
  }

  if (hasNoLiquidado) {
    return hasBoletaPendiente ? "uploaded" : "pending";
  }

  if (hasLiquidado) {
    return "liquidated";
  }

  return null;
}

export function requierePeriodoLiquidacion(
  estado: EstadoLiquidacionResumenFilter
) {
  return estado === "liquidated" || estado === "all";
}

export function boletaEstaEnPeriodo(
  fechaSubida: Date,
  mes?: number,
  anio?: number
) {
  if (!mes || !anio) {
    return true;
  }

  return (
    fechaSubida.getUTCMonth() + 1 === mes &&
    fechaSubida.getUTCFullYear() === anio
  );
}
