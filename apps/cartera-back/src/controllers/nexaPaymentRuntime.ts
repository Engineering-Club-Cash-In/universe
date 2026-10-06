import Big from "big.js";
import { and, asc, desc, eq, inArray, isNotNull, isNull, ne, sql } from "drizzle-orm";
import config from "../config";
import { client, db } from "../database";
import {
  ajuste_fecha_ideal_pago,
  creditos,
  cuotas_credito,
  moras_condonaciones,
  moras_credito,
  nexa_credit_bindings,
  nexa_payment_events,
  pagos_credito,
} from "../database/db";
import { facturarPagoCompleto } from "../routers/cofidi";
import { aplicarPagoAlCredito, insertPayment } from "./registerPayment";
import { createDeferredNexaBilling, runNexaBilling } from "./nexaBilling";
import {
  anularCondonacionNexaATiempo,
  condonarMoraDeCuotas,
  cuotasParaPendienteDeCreditos,
  evaluarCreditoAlDia,
  hoyGuatemala,
} from "./latefee";
import { cobrarRubrosParaBoleta } from "./rubros";
import {
  ALERTA_CONDONACION_NEXA_SIN_AL_DIA,
  cuotaConCierreDiferidoNexa,
  MARCA_CONDONACION_NEXA_CONSERVADA_AL_DIA,
  MARCA_CONDONACION_NEXA_CONSERVADA_PAGO_COMPLETO,
  MARCA_CONDONACION_NEXA_CONSERVADA_PAGO_POSTERIOR,
  decidirCondonacionNexaATiempo,
  motivoCondonacionNexaATiempo,
  pagosPendientesVigentesNexa,
  saldoDeCuotaParaNexa,
} from "../utils/condonacionNexaATiempo";
import {
  withPaymentAdvisoryLock,
  withPaymentBindingLock,
} from "../utils/paymentAdvisoryLock";
import { claimNexaPaymentEvent } from "./nexaPaymentRepository";
import { intentarReciboNexa } from "./nexaReciboPago";
import {
  canAutomaticallyInvoiceNexa,
  CondonacionConservadaError,
  type CondonacionNexaIncierta,
  createNexaPaymentHandler,
  getNexaReceiptFields,
  NexaPaymentError,
  type NexaPaymentBody,
  type NexaPaymentDependencies,
} from "./nexaPayments";

/**
 * Pasa el evento a billing_running. Devuelve "payment_deleted" cuando no arrancó porque el crédito
 * se marcó CAIDO y su pago se borró (pago_id NULL, pago_id_eliminado puesto): no se emitió nada,
 * así que no es un conflicto que mande el evento a billing_unknown.
 */
export async function startNexaBilling(eventId: number): Promise<boolean | "payment_deleted"> {
  const [started] = await db
    .update(nexa_payment_events)
    .set({ status: "billing_running", error: null, updated_at: new Date() })
    .where(and(
      eq(nexa_payment_events.id, eventId),
      inArray(nexa_payment_events.status, ["billing_pending", "billing_failed"]),
      // Nunca se factura un evento cuyo pago se borró (crédito marcado CAIDO).
      isNotNull(nexa_payment_events.pago_id),
    ))
    .returning({ id: nexa_payment_events.id });
  if (started) return true;
  const [borrado] = await db
    .select({ id: nexa_payment_events.id })
    .from(nexa_payment_events)
    .where(and(
      eq(nexa_payment_events.id, eventId),
      isNull(nexa_payment_events.pago_id),
      isNotNull(nexa_payment_events.pago_id_eliminado),
    ))
    .limit(1);
  return borrado ? "payment_deleted" : false;
}

export async function completeNexaBilling(eventId: number, paymentId: number) {
  const [completed] = await db
    .update(nexa_payment_events)
    .set({
      status: "billed",
      pago_id: paymentId,
      error: null,
      updated_at: new Date(),
    })
    .where(and(
      eq(nexa_payment_events.id, eventId),
      eq(nexa_payment_events.status, "billing_running"),
    ))
    .returning({ id: nexa_payment_events.id });
  if (!completed) throw new Error("nexa billing completion fence failed");
}

export async function failNexaBilling(
  eventId: number,
  status: "billing_failed" | "billing_unknown",
  code: string,
) {
  await db
    .update(nexa_payment_events)
    .set({ status, error: code, updated_at: new Date() })
    .where(and(
      eq(nexa_payment_events.id, eventId),
      ne(nexa_payment_events.status, "billed"),
    ));
}

/**
 * Condona la mora de las cuotas que el pago Nexa cubre cuando llegó dentro de
 * 3 días hábiles del vencimiento y deja el crédito al día (regla en
 * `utils/condonacionNexaATiempo.ts`). Corre ANTES de `insertPayment`, que lee
 * `monto_mora` fresco y por eso cobra solo la mora legítima que quedó.
 *
 * Nunca lanza: la condonación es un beneficio, no puede tumbar el cobro. Ante
 * cualquier error (incluida la lectura de rubros) NO condona y lo deja en el
 * log. Y cualquier desenlace es consistente: si la
 * transacción no llegó a escribir, el pago cobra la mora completa como hoy; si
 * escribió, cobra lo que quedó.
 */
export async function condonarMoraNexaATiempo(body: NexaPaymentBody, eventId: number) {
  try {
    if (!body.tokenDate) return;
    const creditoId = body.creditoId;
    const [credito] = await db
      .select({
        statusCredit: creditos.statusCredit,
        capital: creditos.capital,
        cuota: creditos.cuota,
      })
      .from(creditos)
      .where(eq(creditos.credito_id, creditoId))
      .limit(1);
    if (!credito) return;
    const [mora] = await db
      .select({ monto: moras_credito.monto_mora })
      .from(moras_credito)
      .where(and(eq(moras_credito.credito_id, creditoId), eq(moras_credito.activa, true)))
      .limit(1);
    if (!mora || new Big(mora.monto ?? 0).lte(0)) return;

    const hoy = hoyGuatemala();
    const conMora = (await cuotasParaPendienteDeCreditos([creditoId], db, hoy)).get(creditoId);
    if (!conMora) return;

    const abiertas = await db
      .select({
        cuota_id: cuotas_credito.cuota_id,
        numero_cuota: cuotas_credito.numero_cuota,
        fecha_vencimiento: cuotas_credito.fecha_vencimiento,
      })
      .from(cuotas_credito)
      .where(and(eq(cuotas_credito.credito_id, creditoId), eq(cuotas_credito.pagado, false)))
      .orderBy(asc(cuotas_credito.numero_cuota));
    const vencimientoPorCuota = new Map(abiertas.map((c) => [c.cuota_id, c.fecha_vencimiento]));
    // Mismo dedupe que insertPayment: por numero_cuota, gana el mayor cuota_id.
    const porNumero = new Map<number, (typeof abiertas)[number]>();
    for (const c of abiertas) {
      const previa = porNumero.get(c.numero_cuota);
      if (!previa || c.cuota_id > previa.cuota_id) porNumero.set(c.numero_cuota, c);
    }
    const unicas = [...porNumero.values()];
    const pagos = unicas.length === 0 ? [] : await db
      .select({
        cuota_id: pagos_credito.cuota_id,
        pago_id: pagos_credito.pago_id,
        validationStatus: pagos_credito.validationStatus,
        paymentFalse: pagos_credito.paymentFalse,
        pagado: pagos_credito.pagado,
        fecha_pago: pagos_credito.fecha_pago,
        abono_capital: pagos_credito.abono_capital,
        abono_interes: pagos_credito.abono_interes,
        abono_iva_12: pagos_credito.abono_iva_12,
        abono_seguro: pagos_credito.abono_seguro,
        abono_gps: pagos_credito.abono_gps,
        membresias_pago: pagos_credito.membresias_pago,
        monto_aplicado: pagos_credito.monto_aplicado,
      })
      .from(pagos_credito)
      .where(and(
        eq(pagos_credito.credito_id, creditoId),
        inArray(pagos_credito.cuota_id, unicas.map((c) => c.cuota_id)),
      ));
    const [ajuste] = await db
      .select({ id: ajuste_fecha_ideal_pago.id, monto_total: ajuste_fecha_ideal_pago.monto_total })
      .from(ajuste_fecha_ideal_pago)
      .where(and(
        eq(ajuste_fecha_ideal_pago.credito_id, creditoId),
        isNull(ajuste_fecha_ideal_pago.fecha_cobro),
      ))
      .limit(1);
    // SIN la red de `cobroRubrosSeguro`: esa se traga el error y devuelve 0, y
    // con 0 en rubros la simulación sobrestima lo que llega a las cuotas y
    // condonaría sin que el crédito quede al día. Si la lectura falla, el
    // catch de abajo lo deja en el log y NO se condona (fail-safe).
    const rubros = await cobrarRubrosParaBoleta({ credito_id: creditoId, disponible: body.amount });

    const decision = decidirCondonacionNexaATiempo({
      statusCredit: credito.statusCredit,
      capital: conMora.capital,
      moraActiva: mora.monto,
      cuotasConMora: conMora.cuotas.flatMap((c) => {
        const fecha_vencimiento = vencimientoPorCuota.get(c.cuota_id);
        return fecha_vencimiento ? [{ ...c, fecha_vencimiento }] : [];
      }),
      cuotasAbiertas: unicas.map((c) => {
        const pagosCuota = pagos.filter((p) => p.cuota_id === c.cuota_id);
        return {
          ...c,
          saldo: saldoDeCuotaParaNexa(credito.cuota, pagosCuota, hoy),
          cierreDiferido: cuotaConCierreDiferidoNexa(pagosCuota),
          pagosPendientes: pagosPendientesVigentesNexa(pagosCuota, hoy),
        };
      }),
      monto: body.amount,
      fechaBanco: body.tokenDate.slice(0, 10),
      hoy,
      rubrosPendientes: rubros.total,
      ajusteFechaIdeal: ajuste ?? null,
    });
    if (!decision.condonar) return;

    const resultado = await condonarMoraDeCuotas({
      credito_id: creditoId,
      montoMoraEsperado: mora.monto,
      monto: decision.monto,
      cuotas: decision.cuotas,
      nexa_payment_event_id: eventId,
      motivo: motivoCondonacionNexaATiempo(decision.pagosPendientes),
      pagos_pendientes_ids: decision.pagosPendientes,
    });
    if (resultado.kind === "condonada" && decision.pagosPendientes.length > 0) {
      console.warn(JSON.stringify({
        level: "warn",
        event: "nexa.condonacion_a_tiempo.con_pago_pendiente",
        nexa_payment_event_id: eventId,
        credito_id: creditoId,
        condonacion_id: resultado.condonacion_id,
        monto_condonado: resultado.monto,
        pagos_pendientes_ids: decision.pagosPendientes,
      }));
    }
    if (resultado.kind !== "sin_cambio") return { monto: resultado.monto };
  } catch (error) {
    console.error(
      `[nexa] condonación a tiempo omitida (crédito ${body.creditoId}, evento ${eventId}):`,
      error instanceof Error ? error.message : String(error),
    );
  }
}

/**
 * Con el pago Nexa ya aplicado, comprueba que el crédito de verdad quedó al día
 * —con el criterio del cron, el mismo de `desactivarMoraSiCreditoAlDia`—, que
 * era la condición para condonar. La simulación de antes del registro puede
 * equivocarse (un saldo mal estimado, una carrera con otro pago).
 *
 * Si no quedó al día NO anula: el pago sí entró y la condonación ya está en el
 * ledger. Deja alerta durable en dos lugares: un log estructurado de error y
 * la marca en el `motivo` de la condonación viva del evento, que es lo que
 * muestra el reporte de condonaciones (y su Excel) — sin migración ni columna
 * nueva. Nunca lanza.
 */
export async function verificarCondonacionNexaATiempo(creditoId: number, eventId: number) {
  try {
    // En un reintento puede no haber condonación del evento: nada que verificar ni alertar.
    const [viva] = await db
      .select({ condonacion_id: moras_condonaciones.condonacion_id })
      .from(moras_condonaciones)
      .where(and(eq(moras_condonaciones.nexa_payment_event_id, eventId), isNull(moras_condonaciones.anulada_at)))
      .limit(1);
    if (!viva) return;
    const { desactivarMora: alDia, cuotasVencidas } = await evaluarCreditoAlDia(creditoId);
    if (alDia) return;
    const marcadas = await db
      .update(moras_condonaciones)
      .set({ motivo: sql`${moras_condonaciones.motivo} || ${` — ${ALERTA_CONDONACION_NEXA_SIN_AL_DIA}`}` })
      .where(and(
        eq(moras_condonaciones.nexa_payment_event_id, eventId),
        isNull(moras_condonaciones.anulada_at),
        sql`position(${ALERTA_CONDONACION_NEXA_SIN_AL_DIA} in ${moras_condonaciones.motivo}) = 0`,
      ))
      .returning({ condonacion_id: moras_condonaciones.condonacion_id });
    console.error(JSON.stringify({
      level: "error",
      event: "nexa.condonacion_a_tiempo.no_quedo_al_dia",
      nexa_payment_event_id: eventId,
      credito_id: creditoId,
      cuotas_vencidas: cuotasVencidas,
      condonacion_ids: marcadas.map((m) => m.condonacion_id),
    }));
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      event: "nexa.condonacion_a_tiempo.verificacion_fallida",
      nexa_payment_event_id: eventId,
      credito_id: creditoId,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

/**
 * El registro del pago Nexa dejó filas vinculadas al evento pero el desenlace
 * quedó incierto (monto que no cuadra, registro que reventó, proceso que murió
 * antes de completar). La regla es "si el pago entró A MEDIAS":
 *  - las filas vivas vinculadas suman el monto de Nexa (o más) → el pago entró
 *    completo: se CONSERVA siempre, aunque HOY haya otra cuota vencida (una
 *    entrega tardía no puede juzgar el pago con el calendario de ahora);
 *  - suman menos (entró a medias) → se evalúa con el criterio del cron
 *    (`evaluarCreditoAlDia`): al día se conserva; si no, se anula
 *    (`anularCondonacionNexaATiempo`, con su guarda: si hay un pago posterior
 *    no vinculado, la conserva y deja su propia marca).
 * En los dos "se conserva" queda la marca en el `motivo`.
 * Nunca lanza: ante un error la deja viva con el log `viva_sin_verificar`.
 */
export async function reconciliarCondonacionNexaIncierta(creditoId: number, eventId: number, montoNexa: string) {
  const conservar = async (condonacion_id: number, marca: string, razon: string) => {
    await db
      .update(moras_condonaciones)
      .set({ motivo: sql`${moras_condonaciones.motivo} || ${` — ${marca}`}` })
      .where(and(
        eq(moras_condonaciones.condonacion_id, condonacion_id),
        isNull(moras_condonaciones.anulada_at),
        sql`position(${marca} in ${moras_condonaciones.motivo}) = 0`,
      ));
    console.warn(JSON.stringify({
      level: "warn",
      event: "nexa.condonacion_a_tiempo.conservada_pago_incierto",
      razon,
      nexa_payment_event_id: eventId,
      credito_id: creditoId,
      condonacion_id,
    }));
  };
  try {
    const [viva] = await db
      .select({ condonacion_id: moras_condonaciones.condonacion_id })
      .from(moras_condonaciones)
      .where(and(eq(moras_condonaciones.nexa_payment_event_id, eventId), isNull(moras_condonaciones.anulada_at)))
      .limit(1);
    if (!viva) return;
    // Las mismas filas y el mismo monto que mira la saga (sin las anuladas), en Big.
    const filas = await nexaPaymentDependencies.findPayments(eventId, creditoId);
    const entro = filas.reduce((total, fila) => total.plus(fila.amount), new Big(0));
    if (entro.gte(montoNexa)) {
      await conservar(viva.condonacion_id, MARCA_CONDONACION_NEXA_CONSERVADA_PAGO_COMPLETO, "pago_completo");
      return;
    }
    const { desactivarMora: alDia, cuotasVencidas } = await evaluarCreditoAlDia(creditoId);
    if (alDia) {
      await conservar(viva.condonacion_id, MARCA_CONDONACION_NEXA_CONSERVADA_AL_DIA, "al_dia");
      return;
    }
    const resultado = await anularCondonacionNexaATiempo({
      nexa_payment_event_id: eventId,
      motivo: `Pago Nexa incierto y el crédito no quedó al día (${cuotasVencidas} cuota(s) vencida(s)): se anula la condonación a tiempo`,
    });
    logCondonacionConservadaPorPagoPosterior(eventId, resultado);
    console.warn(JSON.stringify({
      level: "warn",
      event: resultado.anulada
        ? "nexa.condonacion_a_tiempo.anulada_pago_incierto"
        : "nexa.condonacion_a_tiempo.conservada_pago_incierto",
      nexa_payment_event_id: eventId,
      credito_id: creditoId,
      cuotas_vencidas: cuotasVencidas,
      ...(resultado.motivo ? { motivo: resultado.motivo } : {}),
    }));
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      event: "nexa.condonacion_a_tiempo.viva_sin_verificar",
      paso: "reconciliar_pago_incierto",
      nexa_payment_event_id: eventId,
      credito_id: creditoId,
      error: error instanceof Error ? error.message : String(error),
    }));
  }
}

/**
 * Qué pasó con la condonación a tiempo del evento de este pago (la última, si
 * hubo varias), para el 503 incierto. Sale de lo durable —`anulada_at` y las
 * marcas del motivo—, así un reintento de nexa-server, que ya no pasa por la
 * saga, recibe lo mismo que la primera respuesta.
 */
export async function condonacionNexaDelPago(body: NexaPaymentBody): Promise<CondonacionNexaIncierta | undefined> {
  const [condonacion] = await db
    .select({ anulada_at: moras_condonaciones.anulada_at, motivo: moras_condonaciones.motivo })
    .from(moras_condonaciones)
    .innerJoin(nexa_payment_events, eq(nexa_payment_events.id, moras_condonaciones.nexa_payment_event_id))
    .where(and(
      eq(nexa_payment_events.provider, "NEXA"),
      eq(nexa_payment_events.external_reference, body.externalReference),
      eq(moras_condonaciones.credito_id, body.creditoId),
    ))
    .orderBy(desc(moras_condonaciones.condonacion_id))
    .limit(1);
  if (!condonacion) return undefined;
  if (condonacion.anulada_at) return "anulada";
  if (condonacion.motivo.includes(MARCA_CONDONACION_NEXA_CONSERVADA_PAGO_POSTERIOR)) return "conservada_pago_posterior";
  if (
    condonacion.motivo.includes(MARCA_CONDONACION_NEXA_CONSERVADA_AL_DIA)
    || condonacion.motivo.includes(MARCA_CONDONACION_NEXA_CONSERVADA_PAGO_COMPLETO)
  ) return "conservada";
  return "sin_verificar";
}

/**
 * El log de una anulación que la guarda de `anularCondonacionNexaATiempo`
 * rechazó por un pago posterior no vinculado (latefee.ts no escribe a
 * `console`: devuelve el motivo y lo deja acá).
 */
const logCondonacionConservadaPorPagoPosterior = (
  nexa_payment_event_id: number,
  resultado: Awaited<ReturnType<typeof anularCondonacionNexaATiempo>>,
) => {
  if (resultado.motivo !== "pago_posterior_no_vinculado") return;
  console.error(JSON.stringify({
    level: "error",
    event: "nexa.condonacion_a_tiempo.viva_sin_verificar",
    motivo: resultado.motivo,
    nexa_payment_event_id,
    credito_id: resultado.credito_id,
    condonacion_id: resultado.condonacion_id,
    pago_id: resultado.pago_id,
  }));
};

const deferredBilling = createDeferredNexaBilling({
  run: (eventId, paymentIds) => runNexaBilling({
    enabled: canAutomaticallyInvoiceNexa({
      environment: config.environment,
      enabled: config.nexaAutomaticInvoicingEnabled,
      simulated: process.env.SIMULAR_FACTURAS === "true",
    }),
    eventId,
    paymentIds,
    start: startNexaBilling,
    invoice: async (paymentId) => {
      const set: { status?: number | string } = { status: 200 };
      const response = await facturarPagoCompleto({
        body: { pago_id: paymentId },
        set,
      });
      const status = typeof set.status === "number" ? set.status : Number(set.status ?? 200);
      return { status: Number.isFinite(status) ? status : 500, response };
    },
  }),
  complete: completeNexaBilling,
  fail: failNexaBilling,
  logError: () => console.error("Nexa billing finalization failed; durable fence retained"),
});

export const nexaPaymentDependencies: NexaPaymentDependencies = {
  withCreditLock: (creditoId, work) => withPaymentAdvisoryLock(
    creditoId,
    (paymentLock) => withPaymentBindingLock(
      paymentLock,
      creditoId,
      (bindingExists) => {
        if (!bindingExists) throw new NexaPaymentError("binding_missing", 403);
        return work(paymentLock);
      },
    ),
  ),
  claim: (body, context) => claimNexaPaymentEvent(
    { query: async (text, values) => {
      const result = await client.query(text, values);
      return { rows: result.rows };
    } },
    body,
    context,
    deferredBilling.isRunning,
  ),
  loadCredit: async (creditoId) => {
    const [row] = await db
      .select({
        usuarioId: creditos.usuario_id,
        statusCredit: creditos.statusCredit,
        bindingCreditoId: nexa_credit_bindings.credito_id,
        activo: nexa_credit_bindings.activo,
        expires_at: nexa_credit_bindings.expires_at,
        max_payment_amount: nexa_credit_bindings.max_payment_amount,
        nexaToken: nexa_credit_bindings.nexa_token,
      })
      .from(creditos)
      .leftJoin(
        nexa_credit_bindings,
        eq(nexa_credit_bindings.credito_id, creditos.credito_id),
      )
      .where(eq(creditos.credito_id, creditoId))
      .limit(1);
    if (!row) return null;
    return {
      usuarioId: row.usuarioId,
      statusCredit: row.statusCredit,
      binding: row.bindingCreditoId === null
        ? null
        : {
            activo: row.activo ?? false,
            expires_at: row.expires_at,
            max_payment_amount: row.max_payment_amount,
            nexa_token: row.nexaToken,
          },
    };
  },
  findPayments: async (eventId, creditoId) => db
    .select({
      paymentId: pagos_credito.pago_id,
      validationStatus: pagos_credito.validationStatus,
      amount: sql<string>`GREATEST(
        COALESCE(${pagos_credito.monto_aplicado}, 0),
        COALESCE(${pagos_credito.abono_capital}, 0)
          + COALESCE(${pagos_credito.abono_interes}, 0)
          + COALESCE(${pagos_credito.abono_iva_12}, 0)
          + COALESCE(${pagos_credito.abono_seguro}, 0)
          + COALESCE(${pagos_credito.abono_gps}, 0)
          + COALESCE(${pagos_credito.membresias_pago}, 0)
          + COALESCE(${pagos_credito.mora}, 0)
          + COALESCE(NULLIF(${pagos_credito.otros}, ''), '0')::numeric
      )`,
    })
    .from(pagos_credito)
    .where(and(
      eq(pagos_credito.credito_id, creditoId),
      eq(pagos_credito.nexaPaymentEventId, eventId),
      // Una fila anulada (paymentFalse) no es un pago: p.ej. la de un evento failed que se anuló
      // antes de que la anulación la desligara. Si contara, el reintento la reaplicaría en vez de
      // registrar limpio. Un evento applied/billed no depende de esto: classifyNexaClaim lo
      // contesta por el status y su pago_id, y estas filas solo completan la lista de ids.
      eq(pagos_credito.paymentFalse, false),
    ))
    .orderBy(asc(pagos_credito.pago_id)),
  registerPayment: async (body, eventId, usuarioId, validateAfterLock, paymentLock) => {
    if (!body.tokenDate) throw new NexaPaymentError("payment_date_required", 503);
    try {
      await validateAfterLock();
    } catch (error) {
      if (error instanceof NexaPaymentError) {
        return { success: false as const, code: error.code, status: error.status };
      }
      throw error;
    }

    const set = { status: 200 };
    const result = await insertPayment({
      body: {
        credito_id: body.creditoId,
        usuario_id: usuarioId,
        monto_boleta: body.amount,
        ...getNexaReceiptFields(body),
        cuotaApagar: 1,
        url_boletas: [],
        registerBy: "NEXA",
        renuevo_o_nuevo: "NEXA",
        origen_pago: "transferencia",
      },
      set,
    }, {
      nexaPaymentEventId: eventId,
      paymentLock,
    });
    return result && "success" in result ? result : {};
  },
  condonarMoraATiempo: condonarMoraNexaATiempo,
  verificarCondonacionATiempo: verificarCondonacionNexaATiempo,
  reconciliarCondonacionIncierta: reconciliarCondonacionNexaIncierta,
  condonacionDelPago: condonacionNexaDelPago,
  anularCondonacionATiempo: async (eventId) => {
    const resultado = await anularCondonacionNexaATiempo({
      nexa_payment_event_id: eventId,
      motivo: "Pago Nexa no registrado: se anula la condonación a tiempo",
    });
    logCondonacionConservadaPorPagoPosterior(eventId, resultado);
    // La negativa no es éxito: la saga responde 503 incierto, no el rechazo.
    if (resultado.motivo) throw new CondonacionConservadaError(resultado.motivo);
  },
  applyPayment: (paymentId, paymentLock) => aplicarPagoAlCredito(paymentId, { paymentLock }),
  complete: async (eventId, paymentId) => {
    await db
      .update(nexa_payment_events)
      .set({
        status: "billing_pending",
        pago_id: paymentId,
        error: null,
        updated_at: new Date(),
        // Recibo por WhatsApp: queda en la bandeja de salida solo con el envío
        // prendido; un reintento no pisa el estado que ya tenga.
        ...(config.reciboPagoWhatsappEnabled
          ? {
              recibo_status: sql`COALESCE(${nexa_payment_events.recibo_status}, 'PENDIENTE')`,
              recibo_actualizado_at: sql`COALESCE(${nexa_payment_events.recibo_actualizado_at}, now())`,
            }
          : {}),
      })
      .where(eq(nexa_payment_events.id, eventId));
  },
  onPaymentApplied: (eventId) => {
    if (!config.reciboPagoWhatsappEnabled) return;
    void intentarReciboNexa(eventId);
  },
  fail: async (eventId, code) => {
    await db
      .update(nexa_payment_events)
      .set({
        status: code === "payment_outcome_uncertain" ? "manual_review" : "failed",
        error: code,
        updated_at: new Date(),
      })
      .where(and(
        eq(nexa_payment_events.id, eventId),
        ne(nexa_payment_events.status, "applied"),
      ));
  },
  billPayments: deferredBilling.run,
  completeBilling: completeNexaBilling,
  failBilling: failNexaBilling,
  now: () => new Date(),
};

export const nexaPaymentHandler = createNexaPaymentHandler({
  secret: process.env.NEXA_INTERNAL_API_SECRET ?? "",
  windowSeconds: Number(process.env.NEXA_HMAC_WINDOW_SECONDS ?? 300),
  dependencies: nexaPaymentDependencies,
});
