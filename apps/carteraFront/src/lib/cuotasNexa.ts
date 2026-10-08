// Franja de cuotas, medio del último pago y rechazos del dashboard Nexa: texto y color, sin React.

export type CuotaFranjaNexa = {
  numero: number;
  vencimiento: string; // YYYY-MM-DD
  pagada: boolean; // criterio del cron de mora (cuotaYaPagadaSql)
  medio: "NEXA" | "MANUAL" | null; // quien puso más plata en la cuota; empate: el pago más reciente
  banco: string | null;
};

export type TonoCuotaNexa = "nexa" | "otro" | "pendiente";

// Morado: pagada por Nexa. Verde: pagada por otro medio. Gris: no pagada (aunque tenga abonos).
export const tonoCuotaNexa = (c: CuotaFranjaNexa): TonoCuotaNexa =>
  !c.pagada ? "pendiente" : c.medio === "NEXA" ? "nexa" : "otro";

export const CLASES_TONO_CUOTA: Record<TonoCuotaNexa, string> = {
  nexa: "bg-purple-600",
  otro: "bg-green-600",
  pendiente: "bg-slate-300",
};

export const fmtDiaNexa = (v: string) => v.split("-").reverse().join("/");

// Nexa: cartera no recibe el banco de origen, se muestra "Nexa". Manual sin banco: "Sin banco".
export const bancoTexto = (medio: "NEXA" | "MANUAL", banco: string | null) =>
  medio === "NEXA" ? "Nexa" : banco ?? "Sin banco";

// "Cuota 18 · vence 05/09/2026 · Pagada · Manual · Banrural"
export const tituloCuotaNexa = (c: CuotaFranjaNexa) => {
  const partes = [`Cuota ${c.numero}`, `vence ${fmtDiaNexa(c.vencimiento)}`, c.pagada ? "Pagada" : "No pagada"];
  if (c.pagada && !c.medio) partes.push("sin detalle del medio");
  if (c.medio) {
    // En Nexa el banco es "Nexa": no se repite.
    const medio = c.medio === "NEXA" ? "Nexa" : `Manual · ${bancoTexto(c.medio, c.banco)}`;
    partes.push(c.pagada ? medio : `abono parcial ${medio}`);
  }
  return partes.join(" · ");
};

export type EstadoCuotaMes = "pagada" | "vencida" | "por_vencer";

export const ESTADO_CUOTA_MES: Record<EstadoCuotaMes, { etiqueta: string; clases: string }> = {
  pagada: { etiqueta: "Pagada", clases: "bg-green-50 text-green-700 border-green-300" },
  vencida: { etiqueta: "Vencida sin pagar", clases: "bg-red-50 text-red-700 border-red-300" },
  por_vencer: { etiqueta: "Por vencer", clases: "bg-slate-100 text-slate-700 border-slate-300" },
};

export type RechazoNexa = { fecha: string | null; monto: string; codigo: string | null; estado: string };

// "1 rechazado · 1 en revisión manual" (+ "· 3 más" si el detalle viene recortado).
export const resumenRechazosNexa = (detalle: RechazoNexa[], total: number) => {
  const rechazados = detalle.filter((r) => r.estado !== "manual_review").length;
  const revision = detalle.length - rechazados;
  const partes: string[] = [];
  if (rechazados) partes.push(`${rechazados} ${rechazados === 1 ? "rechazado" : "rechazados"}`);
  if (revision) partes.push(`${revision} en revisión manual`);
  if (total > detalle.length) partes.push(`${total - detalle.length} más`);
  return partes.join(" · ");
};
