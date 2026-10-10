/**
 * COBROS-02 W4 · Abono inicial de un convenio: reglas puras de validación.
 *
 * Decisión (2026-10-09): el abono se registra como un pago normal, el
 * comprobante lo valida contabilidad, y SOLO después se crea el convenio, que
 * financia lo que queda. Por eso aquí no se toca dinero: se comprueba que el
 * pago existe, es de este crédito, ya está VALIDADO por contabilidad, es de hoy
 * (día GT), tiene monto, y no sirvió ya para otro convenio.
 *
 * Sin base de datos, para probarla aislada.
 */

/** Estados de validación de un pago que ya contabilidad confirmó. */
export const ESTADOS_PAGO_VALIDADO = ["validated", "capital_validated"] as const;

export type PagoParaAbonoInicial = {
  credito_id: number | null;
  validationStatus: string | null;
  /** `paymentFalse`: la boleta se declaró falsa. Conserva estado, monto y fecha, pero ya no aplica. */
  anulado: boolean;
  monto_boleta: string | null;
  /** Día GT del pago, `YYYY-MM-DD`. */
  dia_pago: string | null;
};

export type ErrorAbonoInicial = { status: number; message: string };

/**
 * Motivo por el que el abono NO sirve para el convenio (null si sirve).
 * `diaHoy` es el día GT en que se crea el convenio.
 */
export function motivoAbonoInicialNoValido(params: {
  pago: PagoParaAbonoInicial | null;
  creditoId: number;
  diaHoy: string;
  ligadoAOtroConvenio: boolean;
}): ErrorAbonoInicial | null {
  const { pago, creditoId, diaHoy, ligadoAOtroConvenio } = params;
  if (!pago) {
    return { status: 400, message: "[ERROR] El abono inicial no existe." };
  }
  if (pago.credito_id !== creditoId) {
    return { status: 400, message: "[ERROR] El abono inicial pertenece a otro crédito." };
  }
  if (pago.anulado) {
    return { status: 409, message: "[ERROR] El abono inicial fue anulado (boleta falsa): ya no aplica. Registre un abono nuevo." };
  }
  if (!ESTADOS_PAGO_VALIDADO.includes((pago.validationStatus ?? "") as (typeof ESTADOS_PAGO_VALIDADO)[number])) {
    return {
      status: 409,
      message: "[ERROR] El abono inicial todavía no lo valida contabilidad. Cree el convenio cuando el comprobante esté validado.",
    };
  }
  const monto = Number(pago.monto_boleta ?? 0);
  if (!(monto > 0)) {
    return { status: 400, message: "[ERROR] El abono inicial debe ser mayor que cero." };
  }
  if (pago.dia_pago !== diaHoy) {
    return {
      status: 409,
      message: "[ERROR] El abono inicial debe ser de hoy (día de Guatemala). Registre el abono de nuevo o cree el convenio el mismo día.",
    };
  }
  if (ligadoAOtroConvenio) {
    return { status: 409, message: "[ERROR] Ese abono ya sirvió para otro convenio." };
  }
  return null;
}

/** Lo que hace falta del convenio que usa un abono inicial para decidir si se puede reversar. */
export type ConvenioDelAbono = {
  convenio_id: number;
  activo: boolean;
  completado: boolean;
};

/**
 * Mensaje de bloqueo al reversar un abono inicial. La consulta ya dejó fuera a
 * los convenios anulados o deshechos (liberan el abono) y el rechazo borra la
 * fila. Lo que queda es pendiente, vigente o completado. Un completado no es
 * «vigente»: se mira primero.
 */
export function mensajeBloqueoReversaAbono(c: ConvenioDelAbono): string {
  const cabecera = `[ABONO_INICIAL_DE_CONVENIO] Este pago es el abono inicial del convenio #${c.convenio_id}`;
  if (c.completado) {
    return `${cabecera}, que ya se completó. No se puede reversar sin una corrección manual.`;
  }
  if (c.activo) {
    return `${cabecera}, que está vigente. Anule ese convenio antes de reversarlo.`;
  }
  return `${cabecera}, que sigue pendiente de decisión. Apruébelo o recházelo antes de reversarlo.`;
}

/**
 * Rechazo de negocio con su status HTTP. Los controladores lo lanzan y los
 * routers lo responden tal cual (con el mensaje), en vez de caer al 500
 * genérico. Se distingue por TIPO, no por el texto del mensaje.
 */
export class RechazoAbonoInicial extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RechazoAbonoInicial";
  }
}

/** Rechazo con el que se frena el reverso de un pago que es abono inicial de un convenio. */
export function rechazoReversaAbonoInicial(c: ConvenioDelAbono): RechazoAbonoInicial {
  return new RechazoAbonoInicial(409, mensajeBloqueoReversaAbono(c));
}

/**
 * Día (`YYYY-MM-DD`) de `pagos_credito.fecha_pago`. La columna es un timestamp SIN zona que
 * el registro llena con la hora de pared de Guatemala: leída como Date, sus campos UTC YA son
 * el día GT. Convertirla otra vez a GT restaba 6 h y un abono de las 00:00 a las 05:59 se
 * leía como de ayer. Solo "ahora" (un instante real) se pasa a GT (`partesGT`).
 */
export function diaDeFechaPago(fecha: Date | string | null | undefined): string | null {
  return fecha ? new Date(fecha).toISOString().slice(0, 10) : null;
}
