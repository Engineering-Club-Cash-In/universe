import { z } from "zod";

import { eq, and, not, inArray, isNotNull, desc, sql } from "drizzle-orm";
import Big from "big.js";
import { db } from "../database";
import { setCapitalSource } from "../utils/withAuditContext";
import {
  pagos_credito,
  creditos,
  usuarios,
  cuotas_credito,
  boletas,
  pagos_credito_inversionistas,
  convenios_pago,
  convenio_cuotas,
  facturas_electronicas,
} from "../database/db";
import { processAndReplaceCreditInvestorsReverse } from "./investor";
import { revertirAbonoCapitalEspejo } from "./abonosCapital";
import { updateMora } from "./latefee";
import { SATClientService } from "../cofidi/satClientService";
import { CLUB_CASHIN_CONFIG, SAT_CONFIG } from "../utils/functions/const";
import { ahoraEnGuatemala, formatearFechaSAT } from "../utils/functions/fechaSAT";
import { esPagoAplicado } from "../utils/paymentStatus";
import {
  getRemainingPaymentPaidStatusAfterReversal,
  isReversibleIncobrablePayment,
  REVERSIBLE_CREDIT_STATUSES,
  shouldInstallmentRemainPaidAfterReversal,
  shouldRemoveSameInstallmentPaymentOnReverse,
} from "./reversePaymentPolicy";
import {
  calcularCuotasConvenioCompletadas,
  recomputeCreditAfterCapital,
  shouldIncobrableInstallmentBePaid,
} from "./registerPaymentPolicy";
import {
  emitInvoiceVoiding,
  emitPaymentReversal,
} from "../utils/structuredLogger";
import {
  classifyInvoiceVoidingBatch,
  classifyPaymentReversalCompletion,
  classifyPaymentReversalFailure,
} from "./reversePaymentTelemetry";

const MAX_TELEMETRY_DURATION_MS = 86_400_000;

function safeNow(): number {
  try {
    const value = Date.now();
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function elapsedMilliseconds(startedAt: number): number {
  try {
    const value = safeNow() - startedAt;
    return Math.min(MAX_TELEMETRY_DURATION_MS, Math.max(0, Number.isFinite(value) ? value : 0));
  } catch {
    return 0;
  }
}

function caughtErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const value = Reflect.get(error, "message");
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}
// ============================================================================
// SCHEMA DE VALIDACIÓN
// ============================================================================
export const reversePaymentSchema = z.object({
  credito_id: z.number().int().positive(),
  pago_id: z.number().int().positive(),
});

// ============================================================================
// FUNCIÓN PRINCIPAL: REVERSAR PAGO
// ============================================================================
/**
 * Reversa un pago de crédito:
 * 1. Valida los datos de entrada
 * 2. Verifica que el pago existe y está marcado como pagado
 * 3. Recalcula el capital, interés, IVA y deuda total del crédito
 * 4. Devuelve los abonos a los "restantes" del pago
 * 5. Resetea todos los valores del pago a cero
 * 6. Elimina boletas y pagos de inversionistas asociados
 * 7. Actualiza el saldo a favor del usuario
 *
 * @param body - { credito_id, pago_id }
 * @param set - Handler de respuesta HTTP
 * @returns Objeto con el resultado de la operación
 */
export interface ReversePaymentDependencies {
  readonly runTransaction: typeof db.transaction;
  readonly reverseInvestors: typeof processAndReplaceCreditInvestorsReverse;
  readonly reverseCapitalPayment: typeof revertirAbonoCapitalEspejo;
}

const defaultDependencies: ReversePaymentDependencies = {
  runTransaction: db.transaction.bind(db),
  reverseInvestors: processAndReplaceCreditInvestorsReverse,
  reverseCapitalPayment: revertirAbonoCapitalEspejo,
};

export function createReversePayment(
  dependencies: ReversePaymentDependencies = defaultDependencies,
) {
  return async ({ body, set, telemetryLogger }: any) => {
  const startedAt = safeNow();
  let previousPaymentState: "applied" | "pending" | "unknown" = "unknown";
  let mayHaveGlobalPersistence = false;
  let investmentsReversed = false;
  let transactionCommitted = false;
  try {

    // ========================================================================
    // 1️⃣ VALIDAR ENTRADA
    // ========================================================================
    const parseResult = reversePaymentSchema.safeParse(body);
    if (!parseResult.success) {
      set.status = 400;
      emitPaymentReversal({
        outcome: "rejected",
        previousPaymentState: "unknown",
        creditUpdated: false,
        investmentsReversed: false,
        manualActionRequired: false,
        durationMs: elapsedMilliseconds(startedAt),
        reasonCode: "schema_invalid",
      }, telemetryLogger);
      return {
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      };
    }
    const { credito_id, pago_id } = parseResult.data;

    // ========================================================================
    // 🔥 INICIAR TRANSACCIÓN ATÓMICA
    // ========================================================================
    const result = await dependencies.runTransaction(async (tx) => {
      // ======================================================================
      // 2️⃣ OBTENER DATOS DEL PAGO A REVERSAR
      // ======================================================================
      const [pago] = await tx
        .select()
        .from(pagos_credito)
        .where(
          and(
            eq(pagos_credito.credito_id, credito_id),
            eq(pagos_credito.pago_id, pago_id),
          ),
        )
        .limit(1);

      if (!pago) {
        throw new Error("Payment not found");
      }

      const pagoValidado = esPagoAplicado(pago.validationStatus);
      previousPaymentState = pagoValidado ? "applied" : "pending";


      // ======================================================================
      // 3️⃣ OBTENER DATOS DEL CRÉDITO
      // ======================================================================
      const [creditData] = await tx
        .select()
        .from(creditos)
        .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
        .where(
          and(
            eq(creditos.credito_id, credito_id),
            inArray(creditos.statusCredit, [...REVERSIBLE_CREDIT_STATUSES]),
          ),
        )
        .limit(1);

      if (!creditData) {
        throw new Error("Credit not found or not active");
      }


      // En un INCOBRABLE solo se permite reversar pagos de recuperación reales.
      // Reversar una fila estructural del castigo (system_reset / SISTEMA-INCOBRABLE
      // / SIFCO / abono directo a capital) corrompe el cierre: resetea la fila,
      // borra boletas/inversionistas y, si está `validated`, hasta devuelve capital.
      if (
        creditData.creditos.statusCredit === "INCOBRABLE" &&
        !isReversibleIncobrablePayment({
          validationStatus: pago.validationStatus,
          registerBy: pago.registerBy,
        })
      ) {
        throw new Error("Incobrable structural row cannot be reversed");
      }

      // ======================================================================
      // 4️⃣ OBTENER DATOS DEL USUARIO
      // ======================================================================
      const [user] = await tx
        .select()
        .from(usuarios)
        .where(eq(usuarios.usuario_id, creditData.creditos.usuario_id))
        .limit(1);

      if (!user) {
        throw new Error("User not found");
      }


      // ======================================================================
      // 4️⃣.5️⃣ REVERSAR EL ABONO A CAPITAL DEL ESPEJO (abonos_capital)
      // ======================================================================
      // Borra las filas que ESTE pago generó (van marcadas con su pago_id); si no
      // generó ninguna, no hace nada: el pago_id ya dice la verdad.
      //
      // Tira error si el abono ya se liquidó o si ya entró en un cálculo de
      // pagos, y ahí el reverso no puede seguir.
      //
      // 🔴 VA ACÁ, LO MÁS TEMPRANO POSIBLE, Y NO MÁS ABAJO: de acá para adelante
      // hay tres cosas que escriben FUERA de esta transacción (usan el `db`
      // global, no el `tx`): updateMora (6️⃣), reverseConvenioPayment (6️⃣.5️⃣) y
      // processAndReplaceCreditInvestorsReverse (8️⃣). Si el portero tirara
      // después de ellas, el rollback NO las desharía: el pago quedaría sin
      // revertir pero la mora, el convenio y el saldo del inversionista ya
      // habrían cambiado. Se aborta antes de tocar nada.
      const reversionEspejo = await dependencies.reverseCapitalPayment(pago_id, tx);

      // ======================================================================
      // 4️⃣.6️⃣ LEER LAS FACTURAS ACTIVAS DEL PAGO (ANTES DE TOCARLO)
      // ======================================================================
      // 🔴 LA LECTURA VA ACÁ, NO EN EL PASO 1️⃣2️⃣.5️⃣ DONDE SE ANULAN: más abajo la
      // rama de pago parcial hace `DELETE FROM pagos_credito`, y el FK de
      // `facturas_electronicas.pago_id` es `onDelete: "set null"` (schema.ts):
      // al borrarse el pago la factura NO se borra, pero pierde el vínculo.
      // Para cuando corría el bloque de anulación, el SELECT por `pago_id` ya
      // devolvía 0 filas: no se llamaba a COFIDI, no fallaba nada y la reversa
      // respondía 200 "exitosa" con la factura VIGENTE en SAT (crédito 102,
      // pago 153742, 13-ago-2026: 3 facturas certificadas que quedaron
      // vigentes y sin anular).
      //
      // Leyendo acá capturamos factura_id y uuid mientras el vínculo existe.
      // La anulación en COFIDI sigue ocurriendo abajo, en su paso, y actualiza
      // por `factura_id`, que sigue siendo válido aunque `pago_id` quede NULL.
      const facturasDelPago = await tx
        .select({
          factura_id: facturas_electronicas.factura_id,
          uuid: facturas_electronicas.uuid,
          status: facturas_electronicas.status,
          receptor_nit: facturas_electronicas.receptor_nit,
          fecha_certificacion: facturas_electronicas.fecha_certificacion,
          fecha_emision: facturas_electronicas.fecha_emision,
          serie: facturas_electronicas.serie,
          numero: facturas_electronicas.numero,
        })
        .from(facturas_electronicas)
        .where(
          and(
            eq(facturas_electronicas.pago_id, pago_id),
            eq(facturas_electronicas.status, "ACTIVA"), // Solo anular las activas
          ),
        );


      // ======================================================================
      // 5️⃣ RECALCULAR VALORES DEL CRÉDITO (solo si cuota está pagada)
      // ======================================================================
      let nuevoCapital = new Big(creditData.creditos.capital ?? 0);
      let cuota_interes = new Big(creditData.creditos.cuota_interes ?? 0);
      let iva_12 = new Big(creditData.creditos.iva_12 ?? 0);
      let deudatotal = new Big(creditData.creditos.deudatotal ?? 0);

      if (pagoValidado) {

        const capitalActual = new Big(creditData.creditos.capital ?? 0);
        const abonoCapital = new Big(pago.abono_capital ?? 0);

        // Devuelve el abono al capital. recomputeCreditAfterCapital aplica las
        // invariantes: si es INCOBRABLE no revive interés/IVA y el capital no
        // queda negativo.
        const recomputed = recomputeCreditAfterCapital({
          statusCredit: creditData.creditos.statusCredit,
          newCapital: capitalActual.plus(abonoCapital),
          porcentajeInteres: creditData.creditos.porcentaje_interes,
          seguro: creditData.creditos.seguro_10_cuotas,
          gps: creditData.creditos.gps,
          membresias: creditData.creditos.membresias_pago,
        });
        nuevoCapital = recomputed.capital;
        cuota_interes = recomputed.cuotaInteres;
        iva_12 = recomputed.iva;
        deudatotal = recomputed.deudaTotal;

      }

      // ======================================================================
      // 6️⃣ REVERSAR MORA SI EXISTÍA
      // ======================================================================
      if (pago.mora && Number(pago.mora) > 0) {
        mayHaveGlobalPersistence = true;
        const reverseMoraResult = await updateMora({
          credito_id,
          monto_cambio: Number(pago.mora),
          tipo: "INCREMENTO",
          activa: true,
        });

        if (!reverseMoraResult.success) {
          throw new Error("Error al reversar mora: " + reverseMoraResult.message);
        }
      }

      // ======================================================================
      // 6️⃣.5️⃣ REVERSAR PAGO DE CONVENIO SI EXISTÍA
      // ======================================================================
      if (pago.pagoConvenio && Number(pago.pagoConvenio) > 0) {
        mayHaveGlobalPersistence = true;
        await reverseConvenioPayment({
          credito_id,
          monto_pago: Number(pago.pagoConvenio),
        });
      }

      // ======================================================================
      // 7️⃣ ACTUALIZAR EL CRÉDITO CON LOS NUEVOS VALORES
      // ======================================================================
      if (pagoValidado) {
        await setCapitalSource(tx, "REVERSO");
        await tx
          .update(creditos)
          .set({
            capital: nuevoCapital.toString(),
            deudatotal: deudatotal.toString(),
            cuota_interes: cuota_interes.toString(),
            iva_12: iva_12.toString(),
          })
          .where(eq(creditos.credito_id, credito_id));

      }

      // ======================================================================
      // 8️⃣ REVERSAR INVERSIONES ASOCIADAS AL PAGO
      // ======================================================================
      await dependencies.reverseInvestors(
        credito_id,
        pago_id,
        () => {
          mayHaveGlobalPersistence = true;
        },
      );
      investmentsReversed = true;

      // ======================================================================
      // 9️⃣ DEVOLVER ABONOS A LOS "RESTANTES" DEL PAGO
      // ======================================================================

      const nuevoCapitalRestante = new Big(pago.capital_restante ?? 0).plus(
        pago.abono_capital ?? 0,
      );
      const nuevoInteresRestante = new Big(pago.interes_restante ?? 0).plus(
        pago.abono_interes ?? 0,
      );
      const nuevoIvaRestante = new Big(pago.iva_12_restante ?? 0).plus(
        pago.abono_iva_12 ?? 0,
      );
      const nuevoSeguroRestante = new Big(pago.seguro_restante ?? 0).plus(
        pago.abono_seguro ?? 0,
      );
      const nuevoGpsRestante = new Big(pago.gps_restante ?? 0).plus(
        pago.abono_gps ?? 0,
      );
      const nuevoMembresiasRestante = new Big(pago.membresias ?? 0).plus(
        pago.membresias_pago ?? 0,
      );


      // ======================================================================
      // 🔟 ACTUALIZAR LA CUOTA ASOCIADA (marcar como NO pagada)
      // ======================================================================
      const pagoEstabaPagado = pago.pagado === true;
      if (pagoEstabaPagado) {
        // Si el pago SÍ estaba pagado, actualizamos la cuota y reseteamos el pago


        // ======================================================================
        // 1️⃣1️⃣ RESETEAR EL PAGO (devolver a estado inicial)
        // ======================================================================

        await tx
          .update(pagos_credito)
          .set({
            // Devolver abonos a restantes
            capital_restante: nuevoCapitalRestante.toString(),
            interes_restante: nuevoInteresRestante.toString(),
            iva_12_restante: nuevoIvaRestante.toString(),
            seguro_restante: nuevoSeguroRestante.toString(),
            gps_restante: nuevoGpsRestante.toString(),
            membresias: nuevoMembresiasRestante.toString(),

            // Resetear todos los abonos a CERO
            abono_capital: "0",
            abono_interes: "0",
            abono_iva_12: "0",
            abono_interes_ci: "0",
            abono_iva_ci: "0",
            abono_seguro: "0",
            abono_gps: "0",
            membresias_pago: "0",
            membresias_mes: "0",

            // Resetear montos del pago
            pago_del_mes: "0",
            monto_boleta: "0",
            monto_boleta_cuota: "0",
            monto_aplicado: "0",
            mora: "0",
            otros: "0",
            pagoConvenio: "0",

            // Limpiar metadata
            fecha_pago: null,
            mes_pagado: "",
            pagado: false,
            observaciones: "",

            // Resetear facturación
            seguro_facturado: "0",
            gps_facturado: "0",
            reserva: "0",
            validationStatus: "no_required" as const,
            numeroAutorizacion: "",
            banco_id: null,
            // ⚠️ factura_status NO se toca acá: la anulación de los DTEs es
            // POST-commit y best-effort. Escribir NO_APLICA dentro de la tx
            // abría una ventana (crash entre el commit y el loop de anulación)
            // donde el pago quedaba escondido como NO_APLICA con facturas
            // ACTIVAS vivas. El estado terminal se resuelve al final de la
            // etapa de anulación: NO_APLICA si todo se anuló, FALLIDA si no.
          })
          .where(eq(pagos_credito.pago_id, pago_id));

        await tx.delete(boletas).where(eq(boletas.pago_id, pago_id));
      } else {
        // Pago parcial - verificar si es el único registro de la cuota
        const cantidadPagos = pago.cuota_id === null
          ? 0
          : (await tx
              .select({ count: sql<number>`COUNT(*)` })
              .from(pagos_credito)
              .where(eq(pagos_credito.cuota_id, pago.cuota_id)))[0].count;

        await tx.delete(boletas).where(eq(boletas.pago_id, pago_id));
        await tx
          .delete(pagos_credito_inversionistas)
          .where(eq(pagos_credito_inversionistas.pago_id, pago_id));

        if (Number(cantidadPagos) > 1) {
          // Hay más registros, se puede eliminar este
          await tx
            .delete(pagos_credito)
            .where(eq(pagos_credito.pago_id, pago_id));
        } else {
          // Es el único registro, resetear en vez de eliminar
          await tx
            .update(pagos_credito)
            .set({
              capital_restante: nuevoCapitalRestante.toString(),
              interes_restante: nuevoInteresRestante.toString(),
              iva_12_restante: nuevoIvaRestante.toString(),
              seguro_restante: nuevoSeguroRestante.toString(),
              gps_restante: nuevoGpsRestante.toString(),
              membresias: nuevoMembresiasRestante.toString(),
              abono_capital: "0",
              abono_interes: "0",
              abono_iva_12: "0",
              abono_interes_ci: "0",
              abono_iva_ci: "0",
              abono_seguro: "0",
              abono_gps: "0",
              membresias_pago: "0",
              membresias_mes: "0",
              pago_del_mes: "0",
              monto_boleta: "0",
              monto_boleta_cuota: "0",
              monto_aplicado: "0",
              mora: "0",
              otros: "0",
              pagoConvenio: "0",
              fecha_pago: null,
              mes_pagado: "",
              pagado: false,
              observaciones: "",
              seguro_facturado: "0",
              gps_facturado: "0",
              reserva: "0",
              validationStatus: "no_required" as const,
              numeroAutorizacion: "",
              banco_id: null,
              // factura_status se resuelve POST-anulación (ver rama de arriba).
            })
            .where(eq(pagos_credito.pago_id, pago_id));
        }
      }

      // ======================================================================
      // 1️⃣2️⃣ ELIMINAR BOLETAS ASOCIADAS
      // ======================================================================

      // ======================================================================
      // 1️⃣2️⃣.5️⃣ LAS FACTURAS SE ANULAN DESPUÉS DEL COMMIT, NO ACÁ
      // ======================================================================
      // Acá vivía el loop que llamaba a COFIDI (HTTP a SAT) DENTRO de esta
      // transacción. Dos problemas:
      //
      //   1. Cada llamada tiene `AbortSignal.timeout(60000)` (satClientService):
      //      con 3 facturas la transacción podía retener su conexión y sus locks
      //      sobre pagos_credito/creditos hasta 180s. El pool de trabajo usa el
      //      default de `pg` (10 conexiones), así que un COFIDI lento podía
      //      agotarlo y colgar al backend entero, no solo a las reversas.
      //
      //   2. Peor: si COFIDI anulaba OK y la transacción abortaba después (pasos
      //      13/14/15 o timeout), el DTE quedaba ANULADO en SAT con la BD
      //      restaurada — pago vivo, factura ACTIVA. Y desanular no existe: es
      //      irreversible del lado fiscal.
      //
      // La anulación se movió a después del commit (best-effort). Se invierte
      // el riesgo a la variante recuperable: si falla el UPDATE post-commit, la
      // factura queda ACTIVA en BD pero ANULADA en SAT, que la conciliación de
      // DTEs sí puede detectar y corregir. La respuesta ya tolera parciales vía
      // `facturasConError`.

      // ======================================================================
      // 1️⃣3️⃣ ELIMINAR PAGOS DE INVERSIONISTAS ASOCIADOS
      // ======================================================================
      await tx
        .delete(pagos_credito_inversionistas)
        .where(eq(pagos_credito_inversionistas.pago_id, pago_id));

      // ======================================================================
      // 1️⃣4️⃣ ACTUALIZAR SALDO A FAVOR DEL USUARIO
      // ======================================================================

      const saldoActual = new Big(user.saldo_a_favor ?? 0);
      const montoBoleta = new Big(pago.monto_boleta ?? 0);
      let nuevoSaldoAFavor = saldoActual.minus(montoBoleta);

      // Si el saldo queda negativo, ponerlo en cero
      if (nuevoSaldoAFavor.lt(0)) {
        nuevoSaldoAFavor = new Big(0);
      }


      await tx
        .update(usuarios)
        .set({ saldo_a_favor: nuevoSaldoAFavor.toString() })
        .where(eq(usuarios.usuario_id, user.usuario_id));


      // ======================================================================
      // 1️⃣5️⃣ LIMPIAR SOLO PLACEHOLDERS Y RECALCULAR ESTADO DE LA CUOTA
      // ======================================================================
      let pagosDuplicados: { pago_id: number }[] = [];

      if (pagoEstabaPagado) {

        const pagosMismaCuota = pago.cuota_id === null
          ? []
          : await tx
              .select({
                pago_id: pagos_credito.pago_id,
                monto_aplicado: pagos_credito.monto_aplicado,
                monto_boleta: pagos_credito.monto_boleta,
                validationStatus: pagos_credito.validationStatus,
                paymentFalse: pagos_credito.paymentFalse,
                pagado: pagos_credito.pagado,
              })
              .from(pagos_credito)
              .where(
                and(
                  eq(pagos_credito.cuota_id, pago.cuota_id),
                  eq(pagos_credito.credito_id, credito_id),
                  not(eq(pagos_credito.pago_id, pago_id))
                )
              );

        const ids = pagosMismaCuota
          .filter((p) => shouldRemoveSameInstallmentPaymentOnReverse(p))
          .map((p) => p.pago_id);

        if (ids.length > 0) {
          // Eliminar registros relacionados primero (evita FK constraint)
          await tx.delete(boletas).where(inArray(boletas.pago_id, ids));
          await tx
            .delete(pagos_credito_inversionistas)
            .where(inArray(pagos_credito_inversionistas.pago_id, ids));

          // Ahora sí eliminar los pagos duplicados
          pagosDuplicados = await tx
            .delete(pagos_credito)
            .where(inArray(pagos_credito.pago_id, ids))
            .returning({ pago_id: pagos_credito.pago_id });
        }

        const pagosRestantesCuota = pagosMismaCuota.filter(
          (p) => !ids.includes(p.pago_id),
        );
        let cuotaPermanecePagada = shouldInstallmentRemainPaidAfterReversal({
          cuota: creditData.creditos.cuota,
          remainingPayments: pagosRestantesCuota,
        });

        // INCOBRABLE: el estado de la cuota se rige por el CAPITAL (igual que en
        // el alta), no por la suma de `monto_aplicado`, que se contamina con las
        // filas estructurales del castigo (system_reset / SISTEMA-INCOBRABLE).
        // Tras la reversa, la cuota sigue pagada solo si el capital restaurado
        // (`nuevoCapital`) quedó en 0. Devuelve null si no es incobrable.
        const incobrableCuotaPagada = shouldIncobrableInstallmentBePaid({
          statusCredit: creditData.creditos.statusCredit,
          capital: nuevoCapital.toString(),
          abonoCapital: 0,
        });
        if (incobrableCuotaPagada !== null) {
          cuotaPermanecePagada = incobrableCuotaPagada;
        }

        if (pago.cuota_id !== null) {
          await tx
            .update(cuotas_credito)
            .set({ pagado: cuotaPermanecePagada })
            .where(eq(cuotas_credito.cuota_id, pago.cuota_id));
        }

        const pagosPagadosRestantesIds = pagosRestantesCuota
          .filter((p) => p.pagado === true)
          .map((p) => p.pago_id);

        if (pagosPagadosRestantesIds.length > 0) {
          await tx
            .update(pagos_credito)
            .set({
              pagado: getRemainingPaymentPaidStatusAfterReversal(
                cuotaPermanecePagada,
              ),
            })
            .where(inArray(pagos_credito.pago_id, pagosPagadosRestantesIds));
        }

      }

      // ======================================================================
      // ✅ RETORNAR DATOS DE LA TRANSACCIÓN
      // ======================================================================
      return {
        pago,
        pagoValidado,
        creditData,
        user,
        nuevoCapital,
        deudatotal,
        cuota_interes,
        iva_12,
        nuevoCapitalRestante,
        nuevoInteresRestante,
        nuevoIvaRestante,
        nuevoSaldoAFavor,
        // Las facturas todavía NO se anularon: se hace después del commit.
        facturasDelPago,
        reversionEspejo,
      };
    });
    transactionCommitted = true;
// La reversión NO recalcula ninguna otra fila del crédito. La transacción de
// arriba ya deja todo consistente (pago reseteado, capital/deuda restaurados).
// Aquí vivía un updateInstallments({all: true}) (agregado en 0183a387, ene-2026)
// que reescribía las cuotas YA PAGADAS del crédito: restantes teóricos,
// cuota actual y membresias_pago/membresias_mes en 0 — corrompiendo la
// historia liquidada en cada reversión (los INCOBRABLES ya lo omitían por un
// clavo análogo, PR #890). La proyección teórica de las cuotas pendientes se
// refresca por el flujo normal (siguiente pago aplicado o el botón manual
// "Recalcular Pagos"), igual que antes de enero 2026.
    // ========================================================================
    // 🧾 ANULAR FACTURAS ELECTRÓNICAS — DESPUÉS DEL COMMIT (best-effort)
    // ========================================================================
    // Va acá, FUERA de la transacción, a propósito: la anulación es HTTP a
    // SAT/COFIDI con timeout de 60s por factura. Adentro retenía la conexión y
    // los locks del pago/crédito hasta 60s × N facturas sobre un pool de 10, y
    // sobre todo dejaba abierta la ventana irreversible: COFIDI anula OK →
    // algo falla más abajo → rollback → DTE ANULADO en SAT con el pago vivo en
    // la BD. Desanular no existe.
    //
    // Acá el peor caso es el recuperable: la reversa ya está firme y, si el
    // UPDATE falla, la factura queda ACTIVA en la BD pero ANULADA en SAT, que
    // la conciliación de DTEs detecta comparando ambos lados.
    //
    // Los datos vienen del SELECT del paso 4️⃣.6️⃣, tomado antes de que el DELETE
    // del pago rompiera el vínculo por FK. Se anula por `factura_id`, que sigue
    // siendo válido aunque `pago_id` haya quedado NULL.
    const facturasAnuladas: {
      factura_id: number;
      uuid: string;
      serie: string;
      numero: string;
    }[] = [];
    const facturasConError: {
      factura_id: number;
      uuid: string;
      error?: string;
      mensaje?: string;
    }[] = [];
    const invoiceVoidingStartedAt = safeNow();
    let invoiceProviderRejectedCount = 0;
    let invoiceUnexpectedFailureCount = 0;
    let invoiceLocalStateFailureCount = 0;

    if (result.facturasDelPago.length > 0) {

      for (const factura of result.facturasDelPago) {
        // Cada factura va en su propio try: de acá en adelante la reversa YA
        // está commiteada, así que ningún fallo de esta etapa puede escalar al
        // catch de abajo y convertir un 200 en 500 — el pago quedaría revertido
        // con el cliente creyendo lo contrario. Se reporta en
        // `facturasConError` y se sigue con la próxima.
        try {

          // 1️⃣ ANULAR EN COFIDI
          const resultadoCofidi = await anularFacturaEnCofidi({
            uuid: factura.uuid,
            motivo: `Reversión automática del pago ID: ${pago_id}`,
            factura: {
              receptor_nit: factura.receptor_nit,
              fecha_certificacion: factura.fecha_certificacion,
              fecha_emision: factura.fecha_emision,
            },
          });

          if (resultadoCofidi.success && resultadoCofidi.anulado) {
            // 2️⃣ ACTUALIZAR EN BD (SOLO SI SE ANULÓ EN COFIDI)
            try {
              const filasActualizadas = await db
                .update(facturas_electronicas)
                .set({
                  status: "ANULADA",
                  fecha_anulacion: new Date(),
                  motivo_anulacion: `Reversión automática del pago ID: ${pago_id}`,
                  // `anulada_por` tiene FK contra `platform_users.id`, NO contra
                  // `usuarios.usuario_id`: son namespaces distintos. Acá se
                  // escribía `creditData.creditos.usuario_id` (el id del DEUDOR),
                  // que en producción no existe en platform_users en 1719 de
                  // 1746 casos -> el UPDATE viola el FK, cae en el catch de
                  // abajo y la factura queda ACTIVA en la BD aunque SAT ya la
                  // anuló. En los 27 ids que sí colisionan es peor: pasa en
                  // silencio y le atribuye la anulación a un usuario de
                  // plataforma que no fue.
                  //
                  // El endpoint solo recibe { credito_id, pago_id }: no hay
                  // usuario de sesión en scope. Se deja null, igual que
                  // revertPaymentToPending. Si se quiere trazar quién reversó,
                  // hay que plomar el userId real desde el router (como hace la
                  // anulación manual de cofidi.ts).
                  anulada_por: null,
                })
                .where(
                  eq(facturas_electronicas.factura_id, factura.factura_id),
                )
                .returning({ factura_id: facturas_electronicas.factura_id });

              // Un UPDATE que no matchea ninguna fila NO tira error en
              // Postgres: sin este chequeo la factura entraba a
              // `facturasAnuladas` y la respuesta decía "anulada
              // correctamente" aunque en la BD no hubiera quedado registro.
              // Pasa si el DELETE del pago disparó el CASCADE de `fk_pago` (la
              // FK duplicada que sigue viva en la BD y no está en schema.ts) y
              // se llevó la fila: en SAT quedó ANULADA y acá nadie se entera.
              if (filasActualizadas.length === 0) {
                throw new Error(
                  `El UPDATE no afectó ninguna fila (factura_id ${factura.factura_id} ya no existe en la BD)`,
                );
              }


              facturasAnuladas.push({
                factura_id: factura.factura_id,
                uuid: factura.uuid,
                serie: factura.serie,
                numero: factura.numero,
              });
            } catch (dbError: any) {
              // 🔴 Anulada en SAT pero la BD quedó ACTIVA: va a conciliación.
              invoiceLocalStateFailureCount += 1;

              facturasConError.push({
                factura_id: factura.factura_id,
                uuid: factura.uuid,
                error: "BD_UPDATE_ERROR",
                mensaje: `Anulada en COFIDI pero error al actualizar BD: ${dbError.message}`,
              });
            }
          } else {
            if (resultadoCofidi.error === "EXCEPTION") invoiceUnexpectedFailureCount += 1;
            else invoiceProviderRejectedCount += 1;

            facturasConError.push({
              factura_id: factura.factura_id,
              uuid: factura.uuid,
              error: resultadoCofidi.error,
              mensaje: resultadoCofidi.mensaje,
            });
          }
        } catch (facturaError: any) {
          // Red de seguridad: la reversa ya está firme, esta factura queda para
          // conciliación manual y el resto del lote sigue procesándose.
          invoiceUnexpectedFailureCount += 1;

          facturasConError.push({
            factura_id: factura.factura_id,
            uuid: factura.uuid,
            error: "UNEXPECTED_ERROR",
            mensaje: facturaError?.message ?? String(facturaError),
          });
        }
      }

      const invoiceTerminal = classifyInvoiceVoidingBatch({
        succeededCount: facturasAnuladas.length,
        providerRejectedCount: invoiceProviderRejectedCount,
        unexpectedFailureCount: invoiceUnexpectedFailureCount,
        localStateFailureCount: invoiceLocalStateFailureCount,
        durationMs: elapsedMilliseconds(invoiceVoidingStartedAt),
      });
      if (invoiceTerminal.outcome === "completed") {
        emitInvoiceVoiding({
          outcome: "completed",
          processedCount: invoiceTerminal.processedCount,
          succeededCount: invoiceTerminal.succeededCount,
          failedCount: invoiceTerminal.failedCount,
          manualActionRequired: false,
          durationMs: invoiceTerminal.durationMs,
        }, telemetryLogger);
      } else if (invoiceTerminal.outcome === "provider_rejected") {
        emitInvoiceVoiding({
          outcome: "provider_rejected",
          processedCount: invoiceTerminal.processedCount,
          succeededCount: invoiceTerminal.succeededCount,
          failedCount: invoiceTerminal.failedCount,
          manualActionRequired: true,
          durationMs: invoiceTerminal.durationMs,
          reasonCode: "provider_rejected",
        }, telemetryLogger);
      } else if (invoiceTerminal.outcome === "local_state_inconsistent") {
        emitInvoiceVoiding({
          outcome: "local_state_inconsistent",
          processedCount: invoiceTerminal.processedCount,
          succeededCount: invoiceTerminal.succeededCount,
          failedCount: invoiceTerminal.failedCount,
          manualActionRequired: true,
          durationMs: invoiceTerminal.durationMs,
          errorCode: "persistence_failed",
        }, telemetryLogger);
      } else {
        emitInvoiceVoiding({
          outcome: "failed",
          processedCount: invoiceTerminal.processedCount,
          succeededCount: invoiceTerminal.succeededCount,
          failedCount: invoiceTerminal.failedCount,
          manualActionRequired: true,
          durationMs: invoiceTerminal.durationMs,
          errorCode: invoiceTerminal.errorCode,
        }, telemetryLogger);
      }

    }

    // 🧾 ESTADO TERMINAL DE FACTURACIÓN — solo DESPUÉS de la etapa de anulación
    // (la tx ya no lo escribe: hacerlo antes abría la ventana crash→NO_APLICA
    // con DTEs vivos). NO_APLICA únicamente cuando ya no queda nada por anular;
    // FALLIDA con el detalle cuando algún DTE quedó sin anular, para que el
    // pago aparezca en la bandeja y se resuelva a mano (anulación manual /
    // conciliación). Si un crash corta antes de llegar acá, el pago conserva su
    // estado anterior — impreciso pero nunca ESCONDE facturas vivas.
    // Best-effort: si la reversa borró el pago, el UPDATE no matchea filas.
    try {
      await db
        .update(pagos_credito)
        .set(
          facturasConError.length > 0
            ? {
                factura_status: "FALLIDA" as const,
                factura_error: JSON.stringify(
                  facturasConError.map((f) => ({
                    rubro: "ANULACION",
                    error: `Factura ${f.factura_id} (${f.uuid}) quedó sin anular: ${f.error ?? f.mensaje ?? "sin detalle"}`,
                  }))
                ),
                factura_at: new Date(),
              }
            : {
                factura_status: "NO_APLICA" as const,
                factura_error: null,
                factura_at: null,
              }
        )
        .where(eq(pagos_credito.pago_id, pago_id));
    } catch {
      // Best-effort: la anulación fallida ya quedó reportada arriba por
      // emitInvoiceVoiding (manualActionRequired) y en facturasConError de la
      // respuesta; este marcador de bandeja no puede romper la reversa.
      // (Sin console.*: el slice de reversa usa structured logging y un
      // guard-test lo hace cumplir.)
    }

    // ========================================================================
    // ✅ TRANSACCIÓN COMPLETADA - RETORNAR RESULTADO EXITOSO
    // ========================================================================

    const response = {
      message: "Payment reversed successfully",
      data: {
        reversedPaymentId: pago_id,
        updatedCredit: {
          credito_id: result.creditData.creditos.credito_id,
          capital: result.nuevoCapital.toString(),
          deudatotal: result.deudatotal.toString(),
          cuota_interes: result.cuota_interes.toString(),
          iva_12: result.iva_12.toString(),
        },
        updatedPayment: {
          pago_id,
          capital_restante: result.nuevoCapitalRestante.toString(),
          interes_restante: result.nuevoInteresRestante.toString(),
          iva_12_restante: result.nuevoIvaRestante.toString(),
          pagado: false,
        },
        updatedUser: {
          usuario_id: result.user.usuario_id,
          saldo_a_favor: result.nuevoSaldoAFavor.toString(),
        },
        // Presente solo si el pago era un abono directo a capital.
        abonoCapitalEspejo: result.reversionEspejo?.data ?? undefined,
        // 🆕 Info de facturas anuladas
        facturas:
          result.facturasDelPago.length > 0
            ? {
                total: result.facturasDelPago.length,
                anuladas: facturasAnuladas.length,
                con_error: facturasConError.length,
                detalles: {
                  anuladas: facturasAnuladas,
                  errores: facturasConError,
                },
              }
            : undefined,
      },
    };
    set.status = 200;
    const terminal = classifyPaymentReversalCompletion({
      previousPaymentState: result.pagoValidado ? "applied" : "pending",
      creditUpdated: result.pagoValidado,
      investmentsReversed,
      invoiceFailureCount: facturasConError.length,
      durationMs: elapsedMilliseconds(startedAt),
    });
    if (terminal.outcome === "completed") {
      emitPaymentReversal({
        outcome: "completed",
        previousPaymentState: terminal.previousPaymentState,
        creditUpdated: terminal.creditUpdated,
        investmentsReversed: terminal.investmentsReversed,
        manualActionRequired: false,
        durationMs: terminal.durationMs,
      }, telemetryLogger);
    } else {
      emitPaymentReversal({
        outcome: "partially_completed",
        previousPaymentState: terminal.previousPaymentState,
        creditUpdated: terminal.creditUpdated,
        investmentsReversed: terminal.investmentsReversed,
        manualActionRequired: true,
        durationMs: terminal.durationMs,
        reasonCode: terminal.reasonCode,
      }, telemetryLogger);
    }
    return response;
  } catch (error: unknown) {
    const errorMessage = caughtErrorMessage(error);
    const terminal = classifyPaymentReversalFailure({
      errorMessage,
      transactionCommitted,
      mayHaveGlobalPersistence,
      previousPaymentState,
      investmentsReversed,
      durationMs: elapsedMilliseconds(startedAt),
    });
    if (terminal.outcome === "partially_completed") {
      emitPaymentReversal({
        outcome: "partially_completed",
        previousPaymentState: terminal.previousPaymentState,
        creditUpdated: terminal.creditUpdated,
        investmentsReversed: terminal.investmentsReversed,
        manualActionRequired: true,
        durationMs: terminal.durationMs,
        reasonCode: terminal.reasonCode,
      }, telemetryLogger);
    } else if (terminal.outcome === "rejected") {
      emitPaymentReversal({
        outcome: "rejected",
        previousPaymentState: terminal.previousPaymentState,
        creditUpdated: false,
        investmentsReversed: terminal.investmentsReversed,
        manualActionRequired: terminal.manualActionRequired,
        durationMs: terminal.durationMs,
        reasonCode: terminal.reasonCode,
      }, telemetryLogger);
    } else {
      emitPaymentReversal({
        outcome: "failed",
        previousPaymentState: terminal.previousPaymentState,
        creditUpdated: false,
        investmentsReversed: terminal.investmentsReversed,
        manualActionRequired: terminal.manualActionRequired,
        durationMs: terminal.durationMs,
        errorCode: terminal.errorCode,
      }, telemetryLogger);
    }

    // Determinar status code según el tipo de error
    if (errorMessage === "Payment not found") {
      set.status = 404;
    } else if (
      errorMessage === "Payment is not marked as paid" ||
      errorMessage === "Credit not found or not active" ||
      errorMessage === "Incobrable structural row cannot be reversed" ||
      errorMessage === "User not found" ||
      // Porteros del abono a capital: no es una falla del sistema, es que este
      // pago no se puede revertir hasta resolver el abono a mano.
      errorMessage?.startsWith("[ABONO_YA_LIQUIDADO]") ||
      errorMessage?.startsWith("[ABONO_EN_CALCULO_PENDIENTE]")
    ) {
      set.status = 400;
    } else {
      set.status = 500;
    }

    return {
      message: "Internal server error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
  };
}

export const reversePayment = createReversePayment();

interface ReverseConvenioPaymentParams {
  credito_id: number;
  monto_pago: number;
}

interface ReverseConvenioPaymentResult {
  success: boolean;
  message: string;
  convenio: {
    convenio_id: number;
    monto_total_convenio: string;
    monto_pagado: string;
    monto_pendiente: string;
    cuota_mensual: string;
    pagos_realizados: number;
    pagos_pendientes: number;
    completado: boolean;
    activo: boolean;
  };
  monto_revertido: string;
}

export async function reverseConvenioPayment(
  params: ReverseConvenioPaymentParams,
): Promise<ReverseConvenioPaymentResult> {
  try {
    const { credito_id, monto_pago } = params;


    // 1. Buscar el convenio del crédito (puede estar completado o activo)
    const [convenio] = await db
      .select()
      .from(convenios_pago)
      .where(eq(convenios_pago.credito_id, credito_id))
      .limit(1);

    if (!convenio) {
      throw new Error(
        `No se encontró un convenio para el crédito ID: ${credito_id}`,
      );
    }


    // 2. Convertir valores a Big.js
    const montoPagoBig = new Big(monto_pago);
    const cuotaMensualBig = new Big(convenio.cuota_mensual);
    const montoPagadoActualBig = new Big(convenio.monto_pagado);
    const montoPendienteActualBig = new Big(convenio.monto_pendiente);


    // 3. RESTAR del monto pagado (reversa)
    const nuevoMontoPagadoBig = montoPagadoActualBig.minus(montoPagoBig);

    // 4. SUMAR al monto pendiente (reversa)
    const nuevoMontoPendienteBig = montoPendienteActualBig.plus(montoPagoBig);

    // Validar que no quede negativo
    if (nuevoMontoPagadoBig.lt(0)) {
      throw new Error("No se puede revertir más de lo que se ha pagado");
    }


    // 5. Recalcular cuántas cuotas completas se han pagado — con el MISMO
    // helper de acumulado que usa processConvenioPayment al marcar, para que
    // forward y reverse compartan una sola fórmula (incluye el tope a
    // numero_meses: el floor solo podía dejar pagos_pendientes negativo con
    // un convenio sobre-pagado).
    if (cuotaMensualBig.eq(0)) {
      throw new Error("La cuota mensual del convenio es 0, no se puede recalcular");
    }
    const nuevosPagosRealizados = calcularCuotasConvenioCompletadas({
      montoPagado: nuevoMontoPagadoBig,
      cuotaMensual: cuotaMensualBig,
      montoPendiente: nuevoMontoPendienteBig,
      numeroMeses: convenio.numero_meses,
    });
    const nuevosPagosPendientes = convenio.numero_meses - nuevosPagosRealizados;


    // 6. El convenio ya NO está completado si se revirtió un pago
    const convenioCompletado = nuevoMontoPendienteBig.lte(0);
    const convenioActivo = !convenioCompletado;


    // 7. Actualizar el convenio
    const [convenioActualizado] = await db
      .update(convenios_pago)
      .set({
        monto_pagado: nuevoMontoPagadoBig.toFixed(2),
        monto_pendiente: nuevoMontoPendienteBig.toFixed(2),
        pagos_realizados: nuevosPagosRealizados,
        pagos_pendientes: nuevosPagosPendientes,
        completado: convenioCompletado,
        activo: convenioActivo,
        updated_at: new Date(),
      })
      .where(eq(convenios_pago.convenio_id, convenio.convenio_id))
      .returning();

    // 7.5 Desmarcar las cuotas del convenio que el dinero reversado ya no
    // cubre: el marcado por acumulado (processConvenioPayment) escribe
    // fecha_pago al cruzar cada cuota; sin este espejo la cuota seguía
    // figurando pagada (los readers de cobranza leen fecha_pago) y se dejaba
    // de cobrar dinero que acababa de reversarse. Se desmarcan las más NUEVAS
    // hasta que marcadas == pagos_realizados recalculado.
    const cuotasMarcadas = await db
      .select({
        cuota_convenio_id: convenio_cuotas.cuota_convenio_id,
        numero_cuota: convenio_cuotas.numero_cuota,
      })
      .from(convenio_cuotas)
      .where(
        and(
          eq(convenio_cuotas.convenio_id, convenio.convenio_id),
          isNotNull(convenio_cuotas.fecha_pago)
        )
      )
      .orderBy(desc(convenio_cuotas.numero_cuota));

    const sobremarcadas = cuotasMarcadas.length - nuevosPagosRealizados;
    if (sobremarcadas > 0) {
      const aDesmarcar = cuotasMarcadas.slice(0, sobremarcadas);
      await db
        .update(convenio_cuotas)
        .set({ fecha_pago: null })
        .where(
          inArray(
            convenio_cuotas.cuota_convenio_id,
            aDesmarcar.map((c) => c.cuota_convenio_id)
          )
        );
    }


    // 8. Retornar resultado
    return {
      success: true,
      message: `Pago de Q${montoPagoBig.toFixed(2)} revertido exitosamente del convenio`,
      convenio: {
        convenio_id: convenioActualizado.convenio_id,
        monto_total_convenio: convenioActualizado.monto_total_convenio,
        monto_pagado: convenioActualizado.monto_pagado,
        monto_pendiente: convenioActualizado.monto_pendiente,
        cuota_mensual: convenioActualizado.cuota_mensual,
        pagos_realizados: convenioActualizado.pagos_realizados,
        pagos_pendientes: convenioActualizado.pagos_pendientes,
        completado: convenioActualizado.completado,
        activo: convenioActualizado.activo,
      },
      monto_revertido: montoPagoBig.toFixed(2),
    };
  } catch (error) {
    throw new Error(
      `Error al revertir pago de convenio: ${error instanceof Error ? error.message : "Error desconocido"}`,
    );
  }
}

// ============================================================================
// FUNCIÓN HELPER: ANULAR FACTURA EN COFIDI
// ============================================================================
interface AnularFacturaCofidiParams {
  uuid: string;
  motivo: string;
  factura: {
    receptor_nit: string;
    fecha_certificacion: Date | null;
    fecha_emision: Date | null;
  };
}

interface AnularFacturaCofidiResult {
  success: boolean;
  anulado: boolean;
  descripcion?: string;
  processor?: string;
  error?: string;
  mensaje?: string;
}

export async function anularFacturaEnCofidi(
  params: AnularFacturaCofidiParams,
): Promise<AnularFacturaCofidiResult> {
  try {
    const { uuid, motivo, factura } = params;


    // 1️⃣ CONSTRUIR XML DE ANULACIÓN
    //
    // 📄 `FechaEmisionDocumentoAnular` tiene que coincidir con la
    // `FechaHoraEmision` del DTE original — que es lo que se persiste en
    // `fecha_emision`. Acá se venía priorizando `fecha_certificacion`: en las
    // facturas backdateadas (emisión a fin de mes, certificación días después)
    // eso mandaba a SAT una fecha que no es la del DTE y la anulación moría con
    // `TrCode: [1083] La fecha de emisión del documento a anular no coincide
    // con la registrada en la SAT`. Son 4430 de 22518 facturas con día de
    // emisión distinto al de certificación, y de las 12 reversas que llegaron a
    // intentar anular, las 12 fallaron. Mismo criterio que la anulación manual
    // de `routers/cofidi.ts`.
    const fechaBaseAnulacion = factura.fecha_emision
      ? new Date(factura.fecha_emision)
      : factura.fecha_certificacion
        ? new Date(factura.fecha_certificacion)
        : ahoraEnGuatemala();

    // ⏰ Formato SAT (sin milisegundos ni sufijo Z): `.toISOString()` produce
    // `2026-08-13T11:13:59.000Z` y SAT rechaza el documento. Y `new Date()` a
    // secas para la hora de anulación viaja en UTC, así que una anulación de la
    // noche llegaría a SAT con el día siguiente.
    const fechaEmisionDocumento = formatearFechaSAT(fechaBaseAnulacion);
    const fechaHoraAnulacion = formatearFechaSAT(ahoraEnGuatemala());

    const xmlAnulacion = `<?xml version="1.0" encoding="UTF-8"?>
<dte:GTAnulacionDocumento xmlns:dte="http://www.sat.gob.gt/dte/fel/0.1.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" Version="0.1" xsi:schemaLocation="http://www.sat.gob.gt/dte/fel/0.1.0 GT_AnulacionDocumento-0.1.0.xsd">
  <dte:SAT>
    <dte:AnulacionDTE ID="DatosCertificados">
      <dte:DatosGenerales 
        ID="DatosAnulacion" 
        NumeroDocumentoAAnular="${uuid}" 
        NITEmisor="${CLUB_CASHIN_CONFIG.emisor.nit}" 
        IDReceptor="${factura.receptor_nit || "CF"}" 
        FechaEmisionDocumentoAnular="${fechaEmisionDocumento}" 
        FechaHoraAnulacion="${fechaHoraAnulacion}" 
        MotivoAnulacion="${motivo}"/>
    </dte:AnulacionDTE>
  </dte:SAT>
</dte:GTAnulacionDocumento>`;


    // 2️⃣ CONVERTIR A BASE64
    const xmlBase64 = Buffer.from(xmlAnulacion, "utf-8").toString("base64");

    // 3️⃣ ANULAR EN COFIDI
    const satClient = new SATClientService(
      {
        requestor: SAT_CONFIG.requestor,
        user: SAT_CONFIG.user,
        userName: SAT_CONFIG.userName,
        entity: SAT_CONFIG.entity,
      },
      SAT_CONFIG.endpointUrl,
    );

    const resultado = await satClient.anularDocumento(uuid, xmlBase64);

    if (!resultado.anulado) {
      return {
        success: false,
        anulado: false,
        error: "COFIDI_ERROR",
        mensaje: resultado.descripcion || "Error desconocido en COFIDI",
      };
    }

    return {
      success: true,
      anulado: true,
      descripcion: resultado.descripcion,
      processor: resultado.processor,
    };
  } catch (error: any) {
    return {
      success: false,
      anulado: false,
      error: "EXCEPTION",
      mensaje: error.message || "Error desconocido",
    };
  }
}
