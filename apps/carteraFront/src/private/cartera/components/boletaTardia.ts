// Lógica pura (sin React) del recuadro "boleta pagada a tiempo, registrada tarde".
export type RazonBoletaTardia = "estado_no_aplica" | "sin_mora" | "fuera_de_ventana" | "no_alcanza_mora" | "no_queda_al_dia"
  | "fuera_de_tope" | "boleta_invalida" | "boleta_de_otro_periodo" | "credito_no_encontrado";
export type VistaPreviaBoletaTardia = {
  aplica: boolean; razon: RazonBoletaTardia | null; fechaVencimiento: string | null; fechaBoleta: string; fechaRegistro: string;
  diasRetraso: number | null; montoCondonar: string; moraACobrar: string;
  porCuota: { cuota_id: number; numero_cuota: number; fecha_vencimiento: string; monto: string }[];
  intentoId: string;
};
export type BloqueCondonacionBoletaTardia = { intentoId: string; montoAceptado: string };
export type ParamsPreviewBoletaTardia = { credito_id: number; monto_boleta: number; otros: number; abono_directo_capital: number; fecha_boleta: string };
export type EntornoRecuadro = { esCancelacion: boolean; numeroAutorizacion: string; bancoId: number; hayBoleta: boolean };
export type EstadoRecuadro =
  | { tipo: "oculto" }
  | { tipo: "gris"; motivo: string; vista: VistaPreviaBoletaTardia }
  | { tipo: "casilla"; vista: VistaPreviaBoletaTardia };

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const redondear = (n: number) => Math.round(n * 100) / 100;
const q = (monto: string | number) => `Q${Number(monto).toFixed(2)}`;
const RAZONES_GRISES: Partial<Record<RazonBoletaTardia, string>> = {
  no_queda_al_dia: "Pagó a tiempo, pero este pago no deja el crédito al día: no se puede condonar.",
  no_alcanza_mora: "El pago no alcanza ni para la mora de cuotas anteriores: no se puede condonar.",
};
const MOTIVO_FALTAN_DATOS = "Para condonar hace falta el banco, el número de autorización y la imagen de la boleta.";

export function fechaCortaBoletaTardia(ymd: string): string {
  return `${ymd.slice(8, 10)}-${MESES[Number(ymd.slice(5, 7)) - 1]}`;
}
export function parametrosPreviewBoletaTardia(
  v: { credito_id?: number; monto_boleta?: number; otros?: number; abono_directo_capital?: number; fecha_boleta?: string },
  esCancelacion: boolean,
): ParamsPreviewBoletaTardia | null {
  if (esCancelacion || !v.credito_id || v.credito_id <= 0 || !v.monto_boleta || v.monto_boleta <= 0 || !v.fecha_boleta) return null;
  if (![v.credito_id, v.monto_boleta, v.otros ?? 0, v.abono_directo_capital ?? 0].every(Number.isFinite)) return null;
  return { credito_id: v.credito_id, monto_boleta: v.monto_boleta, otros: v.otros ?? 0, abono_directo_capital: v.abono_directo_capital ?? 0, fecha_boleta: v.fecha_boleta };
}
export function estadoRecuadroBoletaTardia(vista: VistaPreviaBoletaTardia | null | undefined, entorno: EntornoRecuadro): EstadoRecuadro {
  // Sin fecha de vencimiento no hay línea de tiempo ni nada que afirmar (p. ej. cuotas duplicadas): se oculta.
  if (!vista || entorno.esCancelacion || !vista.fechaVencimiento) return { tipo: "oculto" };
  if (!vista.aplica) {
    const motivo = vista.razon ? RAZONES_GRISES[vista.razon] : undefined;
    return motivo ? { tipo: "gris", motivo, vista } : { tipo: "oculto" };
  }
  if (!entorno.numeroAutorizacion.trim() || !entorno.bancoId || !entorno.hayBoleta) return { tipo: "gris", motivo: MOTIVO_FALTAN_DATOS, vista };
  return { tipo: "casilla", vista };
}
export const estaAceptada = (vista: VistaPreviaBoletaTardia | null | undefined, aceptadaIntentoId: string | null): boolean => !!vista && vista.aplica && aceptadaIntentoId !== null && aceptadaIntentoId === vista.intentoId;
export function moraDespuesDeCondonar(mora: number, vista: VistaPreviaBoletaTardia | null | undefined, aceptada: boolean): number {
  if (!aceptada || !vista?.aplica) return mora;
  const monto = Number(vista.montoCondonar);
  if (!Number.isFinite(monto) || monto <= 0) return mora; // monto inválido: la mora no cambia (nunca sube ni da NaN)
  return Math.max(0, redondear(mora - monto));
}
/** Confirmar espera la vista previa solo mientras está en su primera carga; con error o sin params el pago sigue normal. */
export const confirmacionEsperaVistaPrevia = (p: { params: ParamsPreviewBoletaTardia | null; abierto: boolean; cargando: boolean }): boolean =>
  p.abierto && p.params !== null && p.cargando;
/** Mora que realmente se cobra: con la casilla aceptada es la que calculó el servidor (moraACobrar); si no, la local. UNA sola fuente para el modal y para handleFormSubmit. */
export function moraEfectivaParaCobrar(moraLocal: number, vista: VistaPreviaBoletaTardia | null | undefined, aceptada: boolean): number {
  if (!aceptada || !vista?.aplica) return moraLocal;
  const mora = Number(vista.moraACobrar);
  return Number.isFinite(mora) && mora >= 0 ? mora : moraLocal;
}
/** Lo que se tacha en el modal al aceptar: la mora de antes de condonar según el servidor (moraACobrar + montoCondonar). */
export function moraAntesDeCondonar(moraLocal: number, vista: VistaPreviaBoletaTardia | null | undefined, aceptada: boolean): number {
  if (!aceptada || !vista?.aplica) return moraLocal;
  const total = Number(vista.moraACobrar) + Number(vista.montoCondonar);
  return Number.isFinite(total) ? redondear(total) : moraLocal;
}
/**
 * La cascada del modal SIN condonar, para el aviso de "Abonar todo a Capital" (el botón descarta la condonación).
 * `disponible` = boleta − abono directo − otros aplicados. mora → rubros → convenio (se topa pero NO resta) → cuota → excedente.
 * Alimenta SOLO `loQueElAbonoACapitalNoAplica`, nunca `escalonesQueConsumenLaBoleta`.
 */
export function cascadaSinCondonar(p: { disponible: number; mora: number; rubros: number; convenio: number; cuotaNormal: number }) {
  let r = Math.max(0, p.disponible);
  const mora = Math.min(r, Math.max(0, p.mora));
  r -= mora;
  const rubros = Math.min(r, Math.max(0, p.rubros));
  r -= rubros;
  const convenio = Math.min(r, Math.max(0, p.convenio));
  const cuota = p.cuotaNormal > 0 ? Math.min(r, p.cuotaNormal) : 0;
  r -= cuota;
  return { mora, rubros, convenio, cuota, excedente: r };
}
/** Solo viaja si el recuadro está en "casilla" (si pasó a gris después de marcar, no se envía), el monto es válido y hay intentoId. */
export function bloqueCondonacionParaEnviar(vista: VistaPreviaBoletaTardia | null | undefined, aceptadaIntentoId: string | null, entorno: EntornoRecuadro): BloqueCondonacionBoletaTardia | undefined {
  if (!vista || !vista.intentoId || !estaAceptada(vista, aceptadaIntentoId)) return undefined;
  if (estadoRecuadroBoletaTardia(vista, entorno).tipo !== "casilla") return undefined;
  const monto = Number(vista.montoCondonar);
  if (!Number.isFinite(monto) || monto <= 0) return undefined;
  return { intentoId: vista.intentoId, montoAceptado: Number(vista.montoCondonar).toFixed(2) };
}
/** Devuelve "" si falta la fecha de vencimiento o la de la boleta (no hay línea de tiempo que mostrar). */
export function textoFechasBoletaTardia(v: VistaPreviaBoletaTardia): string {
  if (!v.fechaVencimiento || !v.fechaBoleta) return "";
  const dias = v.diasRetraso ?? 0;
  return `Vence ${fechaCortaBoletaTardia(v.fechaVencimiento)} · Boleta ${fechaCortaBoletaTardia(v.fechaBoleta)} · Hoy ${fechaCortaBoletaTardia(v.fechaRegistro)} (${dias} ${dias === 1 ? "día" : "días"} de retraso)`;
}
export function textoMoraDelRetraso(v: VistaPreviaBoletaTardia): string {
  const cuotas = v.porCuota.map((c) => c.numero_cuota).sort((a, b) => a - b);
  return `Mora generada por el retraso: ${q(v.montoCondonar)} · ${cuotas.length === 1 ? "Cuota" : "Cuotas"} ${cuotas.join(", ")}`;
}
export const textoCasillaBoletaTardia = (v: VistaPreviaBoletaTardia): string =>
  `Verifiqué la boleta: es del ${fechaCortaBoletaTardia(v.fechaBoleta)}. Acepto condonar ${q(v.montoCondonar)} (queda a mi nombre)`;
export function esConflictoDeCondonacion(error: unknown): boolean {
  const r = (error as { response?: { status?: number; data?: { code?: string } } } | null)?.response;
  return r?.status === 409 && (r.data?.code === "mora_cambio" || r.data?.code === "ya_no_aplica");
}
const TEXTO_RAZON: Record<RazonBoletaTardia | "mora_cambio", string> = {
  estado_no_aplica: "el estado del crédito no permite condonar",
  sin_mora: "el crédito ya no tiene mora por condonar",
  fuera_de_ventana: "la boleta es posterior al vencimiento o, si vencía en día inhábil, al siguiente día hábil",
  fuera_de_tope: "pasaron más de 5 días desde el vencimiento",
  no_alcanza_mora: "el pago no alcanza ni para la mora de cuotas anteriores",
  no_queda_al_dia: "con este pago el crédito no queda al día",
  boleta_invalida: "la fecha de la boleta no es válida",
  boleta_de_otro_periodo: "la fecha de la boleta es de otro período",
  credito_no_encontrado: "no se encontró el crédito",
  mora_cambio: "la mora cambió mientras tenía abierto el resumen",
};
export function mensajeConflictoCondonacion(error: unknown): string {
  const m = (error as { response?: { data?: { message?: unknown } } } | null)?.response?.data?.message;
  if (typeof m !== "string" || !m) return "La condonación cambió. Revise el nuevo cálculo y vuelva a confirmar.";
  // El servidor agrega la razón técnica entre paréntesis: se cambia por un texto claro.
  return m.replace(/\s*\((\w+)\)/, (todo, razon: string) => (razon in TEXTO_RAZON ? `: ${TEXTO_RAZON[razon as RazonBoletaTardia]}` : todo));
}
/** E-11: texto de aviso si el servidor deshizo la condonación porque el crédito no quedó al día; null si no hay nada que avisar. */
export function avisoCondonacionAnulada(respuesta: unknown): string | null {
  const estado = (respuesta as { condonacionBoletaTardia?: { estado?: string } | null } | null | undefined)?.condonacionBoletaTardia?.estado;
  return estado === "anulada_no_quedo_al_dia"
    ? "El pago se registró, pero el crédito no quedó al día: la condonación se deshizo y la mora sigue vigente."
    : null;
}
