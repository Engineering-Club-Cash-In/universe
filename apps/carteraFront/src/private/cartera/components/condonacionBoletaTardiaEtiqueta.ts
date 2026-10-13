export type CondonacionBoletaTardiaPago = { condonacionId: number; monto: string | number; asesor: string; anulada?: boolean };

function montoYAsesor(c: CondonacionBoletaTardiaPago | null | undefined): string | null {
  if (!c || !c.asesor) return null;
  const monto = Number(c.monto);
  if (!Number.isFinite(monto)) return null;
  return `Q${monto.toFixed(2)} (${c.asesor})`;
}

export function valorCondonacionBoletaTardia(c: CondonacionBoletaTardiaPago | null | undefined): string | null {
  const base = montoYAsesor(c);
  return base ? `${base}${c?.anulada ? " — ANULADA" : ""}` : null;
}

/** "(por toda la boleta)": la condonación es de la boleta completa; no se suma por fila de pago. */
export function etiquetaCondonacionBoletaTardia(c: CondonacionBoletaTardiaPago | null | undefined): string | null {
  const base = montoYAsesor(c);
  if (!base) return null;
  return `Condonación por boleta tardía${c?.anulada ? " ANULADA" : ""} (por toda la boleta): ${base}`;
}

export function claseInsigniaCondonacionBoletaTardia(c: CondonacionBoletaTardiaPago | null | undefined): string {
  return c?.anulada ? "bg-gray-100 text-gray-500 line-through" : "bg-amber-100 text-amber-800";
}
