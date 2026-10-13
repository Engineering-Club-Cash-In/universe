import Big from "big.js";
import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { validationFailed } from "../constants/errorCodes";
import { db } from "../database";
import { moras_condonaciones, pagos_credito } from "../database/db";
import { validarFechaBoleta, ymdDeFechaCalendario } from "../utils/fechaCalendarioGT";
import { motivoCondonacionBoletaTardia } from "../utils/motivoCondonacionBoletaTardia";
import { withPaymentAdvisoryLock } from "../utils/paymentAdvisoryLock";
import { calcularDecisionBoletaTardia } from "./boletaTardiaDecision";
import { anularCondonacionBoletaTardia, condonarMoraDeCuotas, evaluarCreditoAlDia, hoyGuatemala } from "./latefee";
import { insertPayment } from "./registerPayment";
import { camposObligatoriosCondonacion, pagoSchema } from "./registerPaymentPolicy";

export const condonacionBoletaTardiaSchema = z.object({
  intentoId: z.string().uuid(),
  montoAceptado: z.string().regex(/^\d{1,16}\.\d{2}$/),
});

export type DepsBoletaTardia = {
  conLock: typeof withPaymentAdvisoryLock;
  insertPayment: typeof insertPayment;
  decidir: typeof calcularDecisionBoletaTardia;
  condonar: typeof condonarMoraDeCuotas;
  anular: typeof anularCondonacionBoletaTardia;
  evaluarAlDia: typeof evaluarCreditoAlDia;
  /** pago_id de las filas VIVAS (paymentFalse = false) de ESE crédito con ese intento. */
  filasVivas: (credito_id: number, intento_id: string) => Promise<number[]>;
  /** Condonación viva (anulada_at IS NULL) de ESE crédito con ese intento. */
  condonacionViva: (credito_id: number, intento_id: string) => Promise<{ condonacion_id: number; monto: string } | null>;
  /** La condonación más reciente de ESE crédito con ese intento, viva o anulada (null si nunca hubo). */
  condonacionDelIntento: (credito_id: number, intento_id: string) => Promise<{ condonacion_id: number; monto: string; anulada: boolean } | null>;
};

/** `null`/ausente = pago normal (el front manda null con la casilla sin marcar). */
export const traeCondonacionBoletaTardia = (body: any): boolean => body?.condonacionBoletaTardia != null;

export const depsReales = (): DepsBoletaTardia => ({
  conLock: withPaymentAdvisoryLock,
  insertPayment,
  decidir: calcularDecisionBoletaTardia,
  condonar: condonarMoraDeCuotas,
  anular: anularCondonacionBoletaTardia,
  evaluarAlDia: evaluarCreditoAlDia,
  filasVivas: async (credito_id, intento_id) =>
    (await db.select({ pago_id: pagos_credito.pago_id }).from(pagos_credito).where(and(
      eq(pagos_credito.credito_id, credito_id),
      eq(pagos_credito.boletaTardiaIntentoId, intento_id),
      eq(pagos_credito.paymentFalse, false),
    ))).map((f) => f.pago_id),
  condonacionViva: async (credito_id, intento_id) => {
    const [c] = await db.select({ condonacion_id: moras_condonaciones.condonacion_id, monto: moras_condonaciones.montoCondonacion })
      .from(moras_condonaciones)
      .where(and(eq(moras_condonaciones.credito_id, credito_id), eq(moras_condonaciones.intento_id, intento_id), isNull(moras_condonaciones.anulada_at)))
      .limit(1);
    return c ?? null;
  },
  condonacionDelIntento: async (credito_id, intento_id) => {
    const [c] = await db.select({ condonacion_id: moras_condonaciones.condonacion_id, monto: moras_condonaciones.montoCondonacion, anulada_at: moras_condonaciones.anulada_at })
      .from(moras_condonaciones)
      .where(and(eq(moras_condonaciones.credito_id, credito_id), eq(moras_condonaciones.intento_id, intento_id)))
      .orderBy(desc(moras_condonaciones.condonacion_id)).limit(1);
    return c ? { condonacion_id: c.condonacion_id, monto: c.monto, anulada: c.anulada_at !== null } : null;
  },
});

const MENSAJE_MORA_CAMBIO = "La mora cambió desde que se mostró el cálculo. Revise el nuevo monto y vuelva a confirmar.";
const conflicto = (set: { status?: number }, code: "ya_no_aplica" | "mora_cambio", message: string) => {
  set.status = 409;
  return { success: false, code, message };
};
const log = (event: string, datos: Record<string, unknown>) =>
  console.error(JSON.stringify({ level: "error", event: `boleta_tardia.${event}`, ...datos }));

/**
 * /newPayment con `condonacionBoletaTardia`. `opciones.usuarioEmail` es el email VERIFICADO contra la base
 * (la Tarea 7 hace ese chequeo y el de rol en el router); jamás el `registerBy` del body.
 * Todo corre bajo el advisory lock del crédito; la condonación hace COMMIT propio ANTES de insertPayment.
 */
export async function registrarPagoConBoletaTardia(
  ctx: { body: any; set: any },
  opciones: { usuarioEmail: string },
  deps: DepsBoletaTardia = depsReales(),
) {
  const { set } = ctx;
  const bloque = condonacionBoletaTardiaSchema.safeParse(ctx.body?.condonacionBoletaTardia);
  if (!bloque.success) { set.status = 400; return validationFailed(bloque.error.flatten().fieldErrors as never); }
  const base = pagoSchema.safeParse(ctx.body);
  if (!base.success) { set.status = 400; return validationFailed(base.error.flatten().fieldErrors as never); }
  const p = base.data;
  // El freno de duplicados compara exacto: " A-1" ≠ "A-1" registraría (y condonaría) dos veces.
  const numeroAutorizacion = p.numeroAutorizacion?.trim();
  const faltantes = camposObligatoriosCondonacion({ ...p, numeroAutorizacion });
  if (Object.keys(faltantes).length > 0) { set.status = 400; return validationFailed(faltantes); }
  const errorFecha = validarFechaBoleta(p.fecha_boleta, ymdDeFechaCalendario(hoyGuatemala()));
  if (errorFecha) { set.status = 400; return validationFailed({ fecha_boleta: [errorFecha] }); }

  const actor = opciones.usuarioEmail;
  // El pago también queda a nombre del actor verificado: el `registerBy` del body es declarado por el cliente.
  const body = { ...ctx.body, numeroAutorizacion, registerBy: actor };
  const { intentoId, montoAceptado } = bloque.data;
  const creditoId = p.credito_id;

  return deps.conLock(creditoId, async (paymentLock) => {
    // 1. Idempotencia: ya hay filas vivas de ESTE crédito con ese intento → no se vuelve a registrar.
    const previas = await deps.filasVivas(creditoId, intentoId);
    if (previas.length > 0) {
      const c = await deps.condonacionDelIntento(creditoId, intentoId);
      return {
        success: true, idempotent: true, message: "El pago ya estaba registrado", pago_ids: previas,
        condonacionBoletaTardia: c ? { condonacion_id: c.condonacion_id, monto: c.monto, estado: c.anulada ? "anulada_no_quedo_al_dia" as const : "vigente" as const } : null,
      };
    }

    let cond: Awaited<ReturnType<DepsBoletaTardia["condonar"]>>;
    try {
      // 2. Un intento anterior murió entre condonar y registrar: con el lock en mano nadie más registra → se deshace y se recalcula.
      if (await deps.condonacionViva(creditoId, intentoId)) {
        await deps.anular({ intento_id: intentoId, credito_id: creditoId, usuario_email: actor, motivo: "Intento anterior sin pago registrado: se reevalúa la condonación" });
      }
      // 3. Recalcular en el servidor con el body real (antes de condonar nada).
      const decision = await deps.decidir({
        credito_id: creditoId, monto_boleta: p.monto_boleta, otros: p.otros, abono_directo_capital: p.abono_directo_capital, fecha_boleta: p.fecha_boleta,
      });
      if (!decision.aplica) return conflicto(set, "ya_no_aplica", `La condonación ya no aplica (${decision.razon}). Revise el cálculo y vuelva a confirmar.`);
      if (!new Big(decision.montoCondonar).eq(montoAceptado)) return conflicto(set, "mora_cambio", MENSAJE_MORA_CAMBIO);
      // 4. Condonar (COMMIT propio ANTES de insertPayment).
      cond = await deps.condonar({
        credito_id: creditoId, montoMoraEsperado: decision.moraActiva!, monto: decision.montoCondonar,
        cuotas: decision.porCuota.map((c) => ({ cuota_id: c.cuota_id, monto: c.monto })),
        origen: "CONDONACION_BOLETA_TARDIA", intento_id: intentoId, usuario_email: actor,
        motivo: motivoCondonacionBoletaTardia({
          fechaBoleta: p.fecha_boleta, fechaRegistro: decision.fechaRegistro,
          numerosCuota: decision.porCuota.map((c) => c.numero_cuota), email: actor,
        }),
      });
    } catch (error) {
      set.status = 500;
      return { success: false, message: "No se pudo condonar la mora; el pago NO se registró", error: error instanceof Error ? error.message : String(error) };
    }
    if (cond.kind === "sin_cambio") {
      return cond.razon === "mora_cambio"
        ? conflicto(set, "mora_cambio", MENSAJE_MORA_CAMBIO)
        : conflicto(set, "ya_no_aplica", "La condonación ya no aplica. Revise el cálculo y vuelva a confirmar.");
    }

    // 5. Registrar con el lock EN MANO (sin paymentLock pediría otra sesión del lockPool y se colgaría).
    let respuesta: unknown;
    let errorRegistro: unknown;
    try {
      respuesta = await deps.insertPayment({ body, set }, { paymentLock, boletaTardiaIntentoId: intentoId });
    } catch (error) {
      errorRegistro = error;
    }

    // 6. Compensación por lo ESCRITO, no por la respuesta HTTP.
    let filas: number[];
    try {
      filas = await deps.filasVivas(creditoId, intentoId);
    } catch (error) {
      log("filas_no_leidas", { credito_id: creditoId, intento_id: intentoId, error: String(error) });
      if (errorRegistro !== undefined) throw errorRegistro; // no se puede decidir: queda viva y el barrido de huérfanas resuelve
      // El registro fue exitoso: no se le miente al asesor con un error; la condonación queda viva y sin verificar.
      return { ...(respuesta as object), condonacionBoletaTardia: { condonacion_id: cond.condonacion_id, monto: cond.monto, estado: "sin_verificar" as const } };
    }
    // reactivarMora = false (default) a propósito: no se reactiva una mora que el propio registro apagó; el cron la recalcula desde el ledger.
    const anular = async (motivo: string) => {
      try {
        await deps.anular({ intento_id: intentoId, credito_id: creditoId, usuario_email: actor, motivo });
      } catch (error) {
        log("anulacion_fallida", { credito_id: creditoId, intento_id: intentoId, error: String(error) });
        throw error;
      }
    };
    if (filas.length === 0) {
      await anular("El pago no se registró: se deshace la condonación");
      if (errorRegistro !== undefined) throw errorRegistro;
      return respuesta;
    }

    // 7. Verificación posterior: si el crédito no quedó al día, la condonación se cae.
    let estado: "vigente" | "anulada_no_quedo_al_dia" = "vigente";
    try {
      const alDia = await deps.evaluarAlDia(creditoId);
      if (!alDia.desactivarMora) {
        await anular("El crédito no quedó al día tras registrar la boleta: se deshace la condonación");
        estado = "anulada_no_quedo_al_dia";
      }
    } catch (error) {
      log("verificacion_fallida", { credito_id: creditoId, intento_id: intentoId, error: String(error) });
    }
    if (errorRegistro !== undefined) throw errorRegistro;
    return { ...(respuesta as object), condonacionBoletaTardia: { condonacion_id: cond.condonacion_id, monto: cond.monto, estado } };
  });
}
