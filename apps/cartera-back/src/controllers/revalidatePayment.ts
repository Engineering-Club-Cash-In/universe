import { z } from "zod";
import { eq, and, ne } from "drizzle-orm";
import Big from "big.js";
import { db } from "../database";
import { setCapitalSource } from "../utils/withAuditContext";
import { pagos_credito, creditos, cuotas_credito } from "../database/db";
import { insertPagosCreditoInversionistasV2 } from "./payments";
import { esPagoAplicado } from "../utils/paymentStatus";
import {
  calcularCoberturaCuota,
  shouldRejectZeroAppliedNormalValidation,
} from "./registerPaymentPolicy";
import { withPaymentAdvisoryLock } from "../utils/paymentAdvisoryLock";
import { desactivarMoraSiCreditoAlDia } from "./latefee";
import {
  carteraStructuredLogger,
  type CarteraStructuredLogger,
} from "../utils/structuredLogger";

type RevalidatePaymentContext = Readonly<Record<string, unknown>>;

interface ResponseSetter {
  status?: number | string;
}

interface RevalidatePaymentDependencies {
  readonly logger?: CarteraStructuredLogger;
  readonly clock?: () => number;
}

type RevalidationReasonCode =
  | "payment_not_found"
  | "payment_already_applied"
  | "state_conflict";

type RevalidationPublicError =
  | "No se encontró el pago"
  | "El pago ya está validado"
  | "El pago no está pendiente de revalidación"
  | "El pago cambió durante la revalidación";

class RevalidationRejection extends Error {
  constructor(
    readonly reasonCode: RevalidationReasonCode,
    readonly status: 404 | 409,
    readonly publicError: RevalidationPublicError,
  ) {
    super(reasonCode);
  }
}

class RevalidationIntegrityFailure extends Error {
  readonly errorCode = "integrity_violation" as const;
}

function elapsedMilliseconds(clock: () => number, startedAt: number): number {
  return Math.max(0, Math.min(86_400_000, Math.round(clock() - startedAt)));
}

function isResponseSetter(value: unknown): value is ResponseSetter {
  return typeof value === "object" && value !== null;
}

// ============================================================================
// SCHEMA DE VALIDACIÓN
// ============================================================================
export const revalidatePaymentSchema = z.object({
  credito_id: z.number().int().positive(),
  pago_id: z.number().int().positive(),
});

// ============================================================================
// FUNCIÓN PRINCIPAL: REVALIDAR PAGO
// ============================================================================
async function handleRevalidatePayment(
  context: RevalidatePaymentContext,
  dependencies: RevalidatePaymentDependencies,
) {
  if (!isResponseSetter(context.set)) {
    throw new Error("invalid revalidation handler context");
  }
  const body = context.body;
  const set = context.set;
  const logger = dependencies.logger ?? carteraStructuredLogger;
  const clock = dependencies.clock ?? Date.now;
  const startedAt = clock();
  let creditUpdated = false;
  let installmentClosed = false;
  try {
    // 1️⃣ VALIDAR ENTRADA
    const parseResult = revalidatePaymentSchema.safeParse(body);
    if (!parseResult.success) {
      logger.emit("payment.revalidation", "rejected", {
        credit_updated: false,
        installment_closed: false,
        duration_ms: elapsedMilliseconds(clock, startedAt),
        reason_code: "schema_invalid",
      });
      set.status = 400;
      return {
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      };
    }
    const { credito_id, pago_id } = parseResult.data;

    // 🔥 TRANSACCIÓN ATÓMICA bajo el lock por crédito. El lock se espera en
    // el pool DEDICADO (withPaymentAdvisoryLock), NO dentro de la tx: antes,
    // cada waiter del pg_advisory_xact_lock retenía una conexión del pool de
    // trabajo mientras esperaba, y suficientes waiters dejaban sin conexión
    // al dueño del lock (deadlock de pool).
    const result = await withPaymentAdvisoryLock(credito_id, () =>
      db.transaction(async (tx) => {
      // 2️⃣ OBTENER DATOS DEL PAGO
      const [pago] = await tx
        .select()
        .from(pagos_credito)
        .where(
          and(
            eq(pagos_credito.credito_id, credito_id),
            eq(pagos_credito.pago_id, pago_id)
          )
        )
        .limit(1);

      if (!pago) {
        throw new RevalidationRejection(
          "payment_not_found",
          404,
          "No se encontró el pago",
        );
      }
      
      if (esPagoAplicado(pago.validationStatus)) {
        throw new RevalidationRejection(
          "payment_already_applied",
          409,
          "El pago ya está validado",
        );
      }
      if (pago.validationStatus !== "pending" || pago.paymentFalse !== false) {
        throw new RevalidationRejection(
          "state_conflict",
          409,
          "El pago no está pendiente de revalidación",
        );
      }

      if (
        shouldRejectZeroAppliedNormalValidation({
          validationStatus: pago.validationStatus,
          nextValidationStatus: "validated",
          montoAplicado: pago.monto_aplicado,
          mora: pago.mora,
          otros: pago.otros,
          pagoConvenio: pago.pagoConvenio,
        })
      ) {
        return {
          success: false,
          message: `No se puede revalidar el pago ${pago_id}: monto_aplicado es 0.00`,
        };
      }

      // 3️⃣ OBTENER DATOS DEL CRÉDITO
      if (pago.credito_id === null) {
        throw new RevalidationIntegrityFailure();
      }

      const [credito] = await tx
        .select()
        .from(creditos)
        .where(eq(creditos.credito_id, pago.credito_id))
        .limit(1);

      if (!credito) {
        throw new RevalidationIntegrityFailure();
      }

      // 4️⃣ CALCULAR NUEVO CAPITAL (restar el abono_capital del pago)
      const capital_actual = new Big(credito.capital ?? 0);
      const pagosVivosCuota = pago.cuota_id === null
        ? []
        : await tx
            .select({
              pago_id: pagos_credito.pago_id,
              validationStatus: pagos_credito.validationStatus,
              paymentFalse: pagos_credito.paymentFalse,
              abono_capital: pagos_credito.abono_capital,
              abono_interes: pagos_credito.abono_interes,
              abono_iva_12: pagos_credito.abono_iva_12,
              abono_seguro: pagos_credito.abono_seguro,
              abono_gps: pagos_credito.abono_gps,
              membresias_pago: pagos_credito.membresias_pago,
            })
            .from(pagos_credito)
            .where(
              and(
                eq(pagos_credito.cuota_id, pago.cuota_id),
                eq(pagos_credito.validationStatus, "validated"),
                eq(pagos_credito.paymentFalse, false),
                ne(pagos_credito.pago_id, pago_id)
              )
            );
      const otrosPagosVivos = pagosVivosCuota.filter(
        (otroPago) => otroPago.pago_id !== pago_id
      );

      const abono_capital_actual = new Big(pago.abono_capital ?? 0);
      const nuevo_capital = capital_actual.minus(abono_capital_actual);
      const coberturaCuota = calcularCoberturaCuota({
        montoCuota: credito.cuota ?? 0,
        pagos: [...otrosPagosVivos, pago],
        pagoIdEnValidacion: pago_id,
      });

      // 5️⃣ CALCULAR NUEVA DEUDA TOTAL
      const cuota_interes = new Big(nuevo_capital)
        .times(new Big(credito.porcentaje_interes ?? 0).div(100))
        .round(2);
      const iva_12 = cuota_interes.times(0.12).round(2);
      const seguro = new Big(credito.seguro_10_cuotas ?? 0);
      const gps = new Big(credito.gps ?? 0);
      const membresias_pago = new Big(credito.membresias_pago ?? 0);

      const nueva_deuda_total = nuevo_capital
        .plus(cuota_interes)
        .plus(iva_12)
        .plus(seguro)
        .plus(gps)
        .plus(membresias_pago)
        .round(2);

      // 6️⃣ ACTUALIZAR EL CRÉDITO
      if (pago.credito_id !== null) {
        await setCapitalSource(tx, "PAGO");
        await tx
          .update(creditos)
          .set({
            capital: nuevo_capital.toString(),
            deudatotal: nueva_deuda_total.toString(),
            iva_12: iva_12.toString(),
            cuota_interes: cuota_interes.toString(),
          })
          .where(eq(creditos.credito_id, pago.credito_id));
      }

      // 7️⃣ VALIDAR EL PAGO y registrar fecha de aplicación
      const [validatedPayment] = await tx
        .update(pagos_credito)
        .set({ validationStatus: "validated", fecha_aplicado: new Date() })
        .where(
          and(
            eq(pagos_credito.pago_id, pago_id),
            eq(pagos_credito.validationStatus, "pending"),
            eq(pagos_credito.paymentFalse, false)
          )
        )
        .returning({ pago_id: pagos_credito.pago_id });
      if (!validatedPayment) {
        throw new RevalidationRejection(
          "state_conflict",
          409,
          "El pago cambió durante la revalidación",
        );
      }

      let installmentClosed = false;
      if (pago.cuota_id !== null && coberturaCuota.cuotaCompleta) {
        await tx
          .update(cuotas_credito)
          .set({ pagado: true })
          .where(eq(cuotas_credito.cuota_id, pago.cuota_id));
        installmentClosed = true;
      }

      await insertPagosCreditoInversionistasV2(
        pago_id,
        credito_id,
        undefined,
        tx
      );

      return {
        pago_id,
        credito_id,
        nuevoCapital: nuevo_capital.toString(),
        numero_credito_sifco: credito.numero_credito_sifco,
        cuota: credito.cuota,
        installmentClosed,
      };
      })
    );

    if ("success" in result && result.success === false) {
      logger.emit("payment.revalidation", "rejected", {
        credit_updated: false,
        installment_closed: false,
        duration_ms: elapsedMilliseconds(clock, startedAt),
        reason_code: "state_conflict",
      });
      set.status = 400;
      return result;
    }

    creditUpdated = true;
    installmentClosed = result.installmentClosed ?? false;

    // Igual que en aplicarPagoAlCredito: si la revalidación dejó el crédito
    // al día, apagar la mora nacida durante la ventana de validación. Va
    // FUERA de la transacción: el helper lee con otra conexión y necesita
    // ver la cuota ya commiteada como pagada.
    await desactivarMoraSiCreditoAlDia(credito_id, {
      motivo: "Crédito se puso al día al revalidar pago",
    });

    logger.emit("payment.revalidation", "completed", {
      credit_updated: creditUpdated,
      installment_closed: installmentClosed,
      duration_ms: elapsedMilliseconds(clock, startedAt),
    });

    const { installmentClosed: _installmentClosed, ...responseData } = result;

    set.status = 200;
    return {
      message: "Payment revalidated successfully",
      data: responseData,
    };
  } catch (error: unknown) {
    if (error instanceof RevalidationRejection) {
      logger.emit("payment.revalidation", "rejected", {
        credit_updated: false,
        installment_closed: false,
        duration_ms: elapsedMilliseconds(clock, startedAt),
        reason_code: error.reasonCode,
      });
      set.status = error.status;
      return {
        message: "Internal server error",
        error: error.publicError,
      };
    }

    logger.emit("payment.revalidation", "failed", {
      credit_updated: creditUpdated,
      installment_closed: installmentClosed,
      duration_ms: elapsedMilliseconds(clock, startedAt),
      error_code: error instanceof RevalidationIntegrityFailure
        ? error.errorCode
        : "unknown",
    });
    set.status = 500;

    return {
      message: "Internal server error",
    };
  }
}

export function createRevalidatePayment(
  dependencies: RevalidatePaymentDependencies = {},
) {
  return (context: RevalidatePaymentContext) =>
    handleRevalidatePayment(context, dependencies);
}

export const revalidatePayment = createRevalidatePayment();
