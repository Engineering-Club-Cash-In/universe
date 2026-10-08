// Franja de cuotas, medio del último pago y rechazos del dashboard Nexa: texto y color, sin React.
import { fmtQ, sumaQ } from "./moneda";

export type CuotaFranjaNexa = {
  numero: number;
  vencimiento: string; // YYYY-MM-DD
  pagada: boolean; // criterio del cron de mora (cuotaYaPagadaSql)
  medio: "NEXA" | "MANUAL" | null; // quien puso más plata en la cuota; empate: el pago más reciente
  banco: string | null;
  aplicado: string; // monto_aplicado de las filas no anuladas y no 'reset' de la cuota
  monto: string; // monto de la cuota (creditos.cuota)
  // Algún pago que le aplica plata sigue sin validar (validation_status 'pending'). La cuota igual
  // cuenta como pagada si el cron la da por pagada; esto solo avisa que falta validar.
  porValidar: boolean;
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

// No pagada pero con plata aplicada: pago parcial.
export const esParcialNexa = (c: Pick<CuotaFranjaNexa, "pagada" | "aplicado">) => !c.pagada && Number(c.aplicado) > 0;

// Cuánto de la cuota está cubierto, de 0 a 1: la barra se llena en esa proporción. Pagada = llena
// aunque no tenga plata aplicada (la pagó el flag); no pagada nunca llega a 1.
export const fraccionPagadaNexa = (c: Pick<CuotaFranjaNexa, "pagada" | "aplicado" | "monto">) => {
  if (c.pagada) return 1;
  const aplicado = Number(c.aplicado);
  const monto = Number(c.monto);
  if (!(aplicado > 0) || !(monto > 0)) return 0;
  // Topes: un abono chico igual se ve, y un parcial nunca parece completo.
  return Math.min(Math.max(aplicado / monto, 0.08), 0.92);
};

// Relleno de la barra (pagada o parcial) con el color del medio; el carril gris es lo que falta.
export const rellenoCuotaNexa = (c: Pick<CuotaFranjaNexa, "medio">) =>
  CLASES_TONO_CUOTA[c.medio === "NEXA" ? "nexa" : "otro"];

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
// "2026-05-05" -> "may"
export const mesCortoNexa = (v: string) => MESES_CORTOS[Number(v.slice(5, 7)) - 1] ?? "";

// Hoy en Guatemala (YYYY-MM-DD), el mismo "hoy" con que el back decide vencida o por vencer.
export const hoyGuatemala = (ahora = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Guatemala", year: "numeric", month: "2-digit", day: "2-digit" }).format(ahora);

// Días de hoy al vencimiento: positivo = faltan, 0 = hoy, negativo = venció hace N.
export const diasAlVencimiento = (vencimiento: string, hoy: string) => {
  const dia = (v: string) => Date.UTC(Number(v.slice(0, 4)), Number(v.slice(5, 7)) - 1, Number(v.slice(8, 10)));
  return Math.round((dia(vencimiento) - dia(hoy)) / 86_400_000);
};

const dias = (n: number) => `${n} ${n === 1 ? "día" : "días"}`;
const medioTexto = (medio: "NEXA" | "MANUAL" | null, banco: string | null) =>
  medio === "NEXA" ? "Nexa" : medio === "MANUAL" ? `otro medio (${bancoTexto("MANUAL", banco)})` : null;
const faltaQ = (aplicado: string, monto: string) =>
  fmtQ((Math.round(sumaQ([monto]) * 100) - Math.round(sumaQ([aplicado]) * 100)) / 100);

// Estado de una cuota en una frase, para el detalle de la franja.
// "Pagada por Nexa" · "Pagada por otro medio (Banrural)" · "Pago parcial Q 600.00 de Q 1,000.00 por Nexa"
// · "Vencida, sin pagar" · "Por vencer, sin pagar". Con un pago sin validar: "… · pago por validar".
export const estadoCuotaTexto = (c: CuotaFranjaNexa, hoy: string) =>
  `${estadoCuotaBase(c, hoy)}${conPagoPorValidar(c) ? " · pago por validar" : ""}`;

// Solo se avisa si hay plata aplicada (pagada o parcial): sin pago no hay nada que validar.
export const conPagoPorValidar = (c: Pick<CuotaFranjaNexa, "porValidar">) => c.porValidar === true;

const estadoCuotaBase = (c: CuotaFranjaNexa, hoy: string) => {
  const medio = medioTexto(c.medio, c.banco);
  if (c.pagada) return medio ? `Pagada por ${medio}` : "Pagada (sin detalle del medio)";
  const vencida = diasAlVencimiento(c.vencimiento, hoy) < 0;
  if (esParcialNexa(c)) return `${vencida ? "Vencida" : "Por vencer"}, pago parcial ${parcialTexto(c.aplicado, c.monto)}${medio ? ` por ${medio}` : ""}`;
  return vencida ? "Vencida, sin pagar" : "Por vencer, sin pagar";
};

export type TonoAvisoNexa = "nexa" | "otro" | "vencida" | "pendiente";

// La cuota del mes en palabras: un titular (el estado) y un detalle (cuánto y con qué).
// porValidar: va como etiqueta ámbar "Por validar" junto al titular, y en `leido` para lectores de pantalla.
export const avisoCuotaMesNexa = (c: CuotaMesNexa, hoy: string, banco: string | null = null) => {
  const base = avisoCuotaMesBase(c, hoy, banco);
  const porValidar = c.porValidar === true && c.pago !== "sin_pago";
  return { ...base, porValidar, leido: `${base.titulo}${porValidar ? " · Por validar" : ""}` };
};

export const ETIQUETA_POR_VALIDAR = "Por validar";
export const AYUDA_POR_VALIDAR = "Un pago de esta cuota todavía no fue validado por contabilidad.";

const avisoCuotaMesBase = (c: CuotaMesNexa, hoy: string, banco: string | null) => {
  const n = diasAlVencimiento(c.vencimiento, hoy);
  const etiqueta = c.vencimiento.slice(0, 7) === hoy.slice(0, 7) ? "Cuota de este mes" : "Último vencimiento";
  const medio = medioTexto(c.medio, banco);
  if (c.estado === "pagada") {
    return {
      etiqueta,
      tono: (c.medio === "NEXA" ? "nexa" : "otro") as TonoAvisoNexa,
      titulo: c.medio === "NEXA" ? "Pagada por Nexa" : c.medio === "MANUAL" ? "Pagada por otro medio" : "Pagada",
      detalle: c.medio === "MANUAL" ? `Pago completo · ${bancoTexto("MANUAL", banco)}`
        : c.medio === "NEXA" ? "Pago completo" : "Pago completo · sin detalle del medio",
      corto: c.medio === "MANUAL" ? `Completa · ${bancoTexto("MANUAL", banco)}` : "Completa",
    };
  }
  const titulo = c.estado === "vencida"
    ? `Vencida hace ${dias(-n)}`
    : n <= 0 ? "Pendiente · vence hoy" : n === 1 ? "Pendiente · vence mañana" : `Pendiente · vence en ${dias(n)}`;
  const detalle = c.pago === "parcial"
    ? `Pago parcial: ${parcialTexto(c.aplicado, c.monto)}${medio ? ` por ${medio}` : ""} · faltan ${faltaQ(c.aplicado, c.monto)}`
    : `Sin pagos · faltan ${fmtQ(c.monto)}`;
  const corto = c.pago === "parcial"
    ? `Parcial ${parcialTexto(c.aplicado, c.monto)}${c.medio === "NEXA" ? " · Nexa" : c.medio === "MANUAL" ? " · otro medio" : ""}`
    : "Sin pagos";
  return { etiqueta, tono: (c.estado === "vencida" ? "vencida" : "pendiente") as TonoAvisoNexa, titulo, detalle, corto };
};

// Conteo de la franja: "10 pagadas (8 por Nexa) · 1 parcial · 1 sin pagar · 1 con pago por validar"
export const conteoFranjaNexa = (cuotas: CuotaFranjaNexa[]) => {
  const pagadas = cuotas.filter((c) => c.pagada).length;
  const nexa = cuotas.filter((c) => c.pagada && c.medio === "NEXA").length;
  const parciales = cuotas.filter(esParcialNexa).length;
  const sinPagar = cuotas.length - pagadas - parciales;
  const partes = [`${pagadas} ${pagadas === 1 ? "pagada" : "pagadas"}${nexa ? ` (${nexa} por Nexa)` : ""}`];
  if (parciales) partes.push(`${parciales} ${parciales === 1 ? "parcial" : "parciales"}`);
  if (sinPagar) partes.push(`${sinPagar} sin pagar`);
  const porValidar = cuotas.filter(conPagoPorValidar).length;
  if (porValidar) partes.push(`${porValidar} con pago por validar`);
  return partes.join(" · ");
};

// Resumen de la franja para lectores de pantalla.
// "12 cuotas, de nov 2025 a oct 2026: 10 pagadas (8 por Nexa) · 1 parcial · 1 sin pagar"
export const resumenFranjaNexa = (cuotas: CuotaFranjaNexa[]) => {
  if (cuotas.length === 0) return "Sin cuotas";
  const desde = cuotas[0].vencimiento;
  const hasta = cuotas[cuotas.length - 1].vencimiento;
  return `${cuotas.length} ${cuotas.length === 1 ? "cuota" : "cuotas"}, de ${mesCortoNexa(desde)} ${desde.slice(0, 4)} a ${mesCortoNexa(hasta)} ${hasta.slice(0, 4)}: ${conteoFranjaNexa(cuotas)}`;
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
  if (conPagoPorValidar(c)) partes.push("pago por validar");
  return partes.join(" · ");
};

export type EstadoCuotaMes = "pagada" | "vencida" | "por_vencer";

export const ESTADO_CUOTA_MES: Record<EstadoCuotaMes, { etiqueta: string; clases: string }> = {
  pagada: { etiqueta: "Pagada", clases: "bg-green-50 text-green-700 border-green-300" },
  vencida: { etiqueta: "Vencida", clases: "bg-red-50 text-red-700 border-red-300" },
  por_vencer: { etiqueta: "Por vencer", clases: "bg-slate-100 text-slate-700 border-slate-300" },
};

// Filtro de la tabla: pagados = cuota del mes pagada; parciales = no pagada con plata aplicada;
// sinpago = no pagada y sin plata aplicada. (El back aún acepta "pendientes" = parciales + sinpago.)
export type FiltroCuotaMes = "pagados" | "parciales" | "sinpago";
export type PagoCuotaMes = "completa" | "parcial" | "sin_pago";

export type CuotaMesNexa = {
  numero: number;
  vencimiento: string; // YYYY-MM-DD
  estado: EstadoCuotaMes;
  pago: PagoCuotaMes; // completa: pagada (cron); parcial: no pagada con plata aplicada; sin_pago
  aplicado: string;
  monto: string;
  medio: "NEXA" | "MANUAL" | null; // el mismo de la franja
  porValidar: boolean; // algún pago que le aplica plata sigue sin validar (el de la franja)
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
