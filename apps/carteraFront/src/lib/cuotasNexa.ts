// Franja de cuotas, medio del último pago y rechazos del dashboard Nexa: texto y color, sin React.
import { fmtQ } from "./moneda";

export type CuotaFranjaNexa = {
  numero: number;
  vencimiento: string; // YYYY-MM-DD
  pagada: boolean; // criterio del cron de mora (cuotaYaPagadaSql)
  medio: "NEXA" | "MANUAL" | null; // quien puso más plata en la cuota; empate: el pago más reciente
  banco: string | null;
  aplicado: string; // monto_aplicado de las filas no anuladas y no 'reset' de la cuota
  monto: string; // monto de la cuota (creditos.cuota)
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

// No pagada pero con plata aplicada: la barra gris lleva un borde del color del medio.
export const esParcialNexa = (c: Pick<CuotaFranjaNexa, "pagada" | "aplicado">) => !c.pagada && Number(c.aplicado) > 0;
export const BORDE_PARCIAL: Record<"NEXA" | "MANUAL", string> = {
  NEXA: "border-2 border-purple-600",
  MANUAL: "border-2 border-green-600",
};

export const fmtDiaNexa = (v: string) => v.split("-").reverse().join("/");

// Nexa: cartera no recibe el banco de origen, se muestra "Nexa". Manual sin banco: "Sin banco".
export const bancoTexto = (medio: "NEXA" | "MANUAL", banco: string | null) =>
  medio === "NEXA" ? "Nexa" : banco ?? "Sin banco";

// "pago parcial Q 500.00 de Q 1,752.36"
const parcialTexto = (aplicado: string, monto: string) => `${fmtQ(aplicado)} de ${fmtQ(monto)}`;

// "Cuota 18 · vence 05/09/2026 · Pagada · pago completo · Manual · Banrural"
// "Cuota 18 · vence 05/09/2026 · No pagada · pago parcial Q 500.00 de Q 1,752.36 · Nexa"
export const tituloCuotaNexa = (c: CuotaFranjaNexa) => {
  const partes = [`Cuota ${c.numero}`, `vence ${fmtDiaNexa(c.vencimiento)}`, c.pagada ? "Pagada" : "No pagada"];
  if (c.pagada) partes.push("pago completo");
  else if (esParcialNexa(c)) partes.push(`pago parcial ${parcialTexto(c.aplicado, c.monto)}`);
  if (c.pagada && !c.medio) partes.push("sin detalle del medio");
  if (c.medio) {
    // En Nexa el banco es "Nexa": no se repite.
    const medio = c.medio === "NEXA" ? "Nexa" : `Manual · ${bancoTexto(c.medio, c.banco)}`;
    partes.push(medio);
  }
  return partes.join(" · ");
};

export type EstadoCuotaMes = "pagada" | "vencida" | "por_vencer";

export const ESTADO_CUOTA_MES: Record<EstadoCuotaMes, { etiqueta: string; clases: string }> = {
  pagada: { etiqueta: "Pagada", clases: "bg-green-50 text-green-700 border-green-300" },
  vencida: { etiqueta: "Vencida", clases: "bg-red-50 text-red-700 border-red-300" },
  por_vencer: { etiqueta: "Por vencer", clases: "bg-slate-100 text-slate-700 border-slate-300" },
};

// Filtro de la tabla: pagados = cuota del mes pagada; pendientes = vencida o por vencer.
export type FiltroCuotaMes = "pagados" | "pendientes";
export type PagoCuotaMes = "completa" | "parcial" | "sin_pago";

export type CuotaMesNexa = {
  numero: number;
  vencimiento: string; // YYYY-MM-DD
  estado: EstadoCuotaMes;
  pago: PagoCuotaMes; // completa: pagada (cron); parcial: no pagada con plata aplicada; sin_pago
  aplicado: string;
  monto: string;
  medio: "NEXA" | "MANUAL" | null; // el mismo de la franja
};

// "Completa · Nexa", "Completa · Manual", "Parcial · Q 500.00 de Q 1,752.36", "Sin pago"
export const pagoCuotaMesTexto = (c: CuotaMesNexa) =>
  c.pago === "completa" ? `Completa · ${c.medio === "NEXA" ? "Nexa" : "Manual"}`
  : c.pago === "parcial" ? `Parcial · ${parcialTexto(c.aplicado, c.monto)}`
  : "Sin pago";

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
