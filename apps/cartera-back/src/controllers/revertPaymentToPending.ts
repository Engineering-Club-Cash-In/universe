import { z } from "zod";
import { eq, and, or } from "drizzle-orm";
import Big from "big.js";
import { db } from "../database";
import { setCapitalSource } from "../utils/withAuditContext";
import {
  pagos_credito,
  creditos,
  pagos_credito_inversionistas,
  facturas_electronicas,
} from "../database/db";
import { processAndReplaceCreditInvestorsReverse } from "./investor";
import { anularFacturaEnCofidi } from "./reversePayment";
import { emitPaymentReversalToPending } from "../utils/structuredLogger";

function safeNow(): number {
  try {
    const value = Date.now();
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

function elapsedMilliseconds(startedAt: number): number {
  return Math.max(0, Math.min(86_400_000, Math.round(safeNow() - startedAt)));
}

// ============================================================================
// SCHEMA DE VALIDACIÓN
// ============================================================================
export const revertPaymentToPendingSchema = z.object({
  credito_id: z.number().int().positive(),
  pago_id: z.number().int().positive(),
});

// ============================================================================
// HELPER: REVERTIR INVERSIONES
// ============================================================================
export interface RevertPaymentToPendingDependencies {
  readonly runTransaction: typeof db.transaction;
  readonly reverseInvestors: typeof processAndReplaceCreditInvestorsReverse;
  readonly voidInvoice: typeof anularFacturaEnCofidi;
  readonly setCapitalSource: typeof setCapitalSource;
  readonly emitTerminal: typeof emitPaymentReversalToPending;
}

const defaultDependencies: RevertPaymentToPendingDependencies = {
  runTransaction: db.transaction.bind(db),
  reverseInvestors: processAndReplaceCreditInvestorsReverse,
  voidInvoice: anularFacturaEnCofidi,
  setCapitalSource,
  emitTerminal: emitPaymentReversalToPending,
};

async function reverseAndCleanInvestors(
  tx: any,
  credito_id: number,
  pago_id: number,
  dependencies: RevertPaymentToPendingDependencies,
) {
  await dependencies.reverseInvestors(credito_id, pago_id);
  
  await tx
    .delete(pagos_credito_inversionistas)
    .where(eq(pagos_credito_inversionistas.pago_id, pago_id));
}

// ============================================================================
// FUNCIÓN PRINCIPAL: PASAR PAGO A PENDIENTE
// ============================================================================
export function createRevertPaymentToPending(
  dependencies: RevertPaymentToPendingDependencies = defaultDependencies,
) {
  return async ({ body, set }: any) => {
  const startedAt = safeNow();
  try {
    // 1️⃣ VALIDAR ENTRADA
    const parseResult = revertPaymentToPendingSchema.safeParse(body);
    if (!parseResult.success) {
      dependencies.emitTerminal({
        outcome: "rejected",
        reasonCode: "schema_invalid",
        durationMs: elapsedMilliseconds(startedAt),
      });
      set.status = 400;
      return {
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      };
    }
    const { credito_id, pago_id } = parseResult.data;

    // 🔥 INICIAR TRANSACCIÓN ATÓMICA
    const result = await dependencies.runTransaction(async (tx) => {
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
        throw new Error("Payment not found");
      }

      const pagoValidado = pago.validationStatus === "validated";

      // 3️⃣ OBTENER DATOS DEL CRÉDITO
      const [creditData] = await tx
        .select()
        .from(creditos)
        .where(
          and(
            eq(creditos.credito_id, credito_id),
            or(
              eq(creditos.statusCredit, "ACTIVO"),
              eq(creditos.statusCredit, "MOROSO"),
              eq(creditos.statusCredit, "EN_CONVENIO")
            )
          )
        )
        .limit(1);

      if (!creditData) {
        throw new Error("Credit not found or not active");
      }


      // Ojo: acá NO se revierten los abonos a capital del espejo. `pagoValidado`
      // solo reconoce `validated`, así que un `capital_validated` cae en el
      // early-return de abajo sin devolver el capital ni cambiar de estado;
      // borrarle los abonos antes lo dejaría a medias (abono borrado + pago
      // todavía aplicado). Los pagos que esta ruta sí maneja (cuotas normales)
      // nunca generan abonos, así que no hay nada que revertir.
      // El reverso del abono vive en reversePayment.ts, que usa esPagoAplicado
      // y sí reconoce los abonos directos a capital.

      if (!pagoValidado) {
        await reverseAndCleanInvestors(tx, credito_id, pago_id, dependencies);

        return {
          data: {
            pago_id,
            credito_id,
            numero_credito_sifco: creditData.numero_credito_sifco,
            cuota: creditData.cuota,
            message: "Inversiones reversadas exitosamente (el pago ya estaba pendiente)"
          },
          completion: {
            reversalPath: "already_pending" as const,
            processedCount: 0,
            succeededCount: 0,
            failedCount: 0,
          },
        };
      }

      // 4️⃣ RECALCULAR VALORES DEL CRÉDITO
      let nuevoCapital = new Big(creditData.capital ?? 0);
      let cuota_interes = new Big(creditData.cuota_interes ?? 0);
      let iva_12 = new Big(creditData.iva_12 ?? 0);
      let deudatotal = new Big(creditData.deudatotal ?? 0);

      if (pagoValidado) {
        const capitalActual = new Big(creditData.capital ?? 0);
        const abonoCapital = new Big(pago.abono_capital ?? 0);
        nuevoCapital = capitalActual.plus(abonoCapital);


        const porcentajeInteres = new Big(creditData.porcentaje_interes ?? 0).div(100);
        cuota_interes = nuevoCapital.times(porcentajeInteres).round(2);
        iva_12 = cuota_interes.times(0.12).round(2);


        deudatotal = nuevoCapital
          .plus(cuota_interes)
          .plus(iva_12)
          .plus(creditData.seguro_10_cuotas ?? 0)
          .plus(creditData.gps ?? 0)
          .plus(creditData.membresias_pago ?? 0);


        await dependencies.setCapitalSource(tx, "REVERSO");
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

      // 5️⃣ REVERTIR Y ELIMINAR INVERSIONES
      await reverseAndCleanInvestors(tx, credito_id, pago_id, dependencies);

      // 6️⃣ ANULAR FACTURAS ELECTRÓNICAS
      const facturasDelPago = await tx
        .select()
        .from(facturas_electronicas)
        .where(
          and(
            eq(facturas_electronicas.pago_id, pago_id),
            eq(facturas_electronicas.status, "ACTIVA")
          )
        );

      const facturasAnuladas = [];
      const facturasConError = [];

      if (facturasDelPago.length > 0) {
        for (const factura of facturasDelPago) {
          const resultadoCofidi = await dependencies.voidInvoice({
            uuid: factura.uuid,
            motivo: `Reversión automática del pago ID: ${pago_id}`,
            factura: {
              receptor_nit: factura.receptor_nit,
              fecha_certificacion: factura.fecha_certificacion,
              fecha_emision: factura.fecha_emision,
            },
          });

          if (resultadoCofidi.success && resultadoCofidi.anulado) {
            try {
              await tx
                .update(facturas_electronicas)
                .set({
                  status: "ANULADA",
                  fecha_anulacion: new Date(),
                  motivo_anulacion: `Reversión automática del pago ID: ${pago_id}`,
                  anulada_por: null,
                })
                .where(eq(facturas_electronicas.factura_id, factura.factura_id));


              facturasAnuladas.push({
                factura_id: factura.factura_id,
                uuid: factura.uuid,
                serie: factura.serie,
                numero: factura.numero,
              });
            } catch (dbError: any) {
              facturasConError.push({
                factura_id: factura.factura_id,
                uuid: factura.uuid,
                error: "BD_UPDATE_ERROR",
                mensaje: "Anulada en COFIDI pero error al actualizar BD",
              });
            }
           } else {
             facturasConError.push({
               factura_id: factura.factura_id,
               uuid: factura.uuid,
               error: resultadoCofidi.error,
               mensaje: resultadoCofidi.mensaje,
             });
          }
        }
      }

      // 7️⃣ ACTUALIZAR ESTADO DEL PAGO A PENDING Y ANULAR FECHA
      await tx
        .update(pagos_credito)
        .set({
          validationStatus: "pending",
          fecha_aplicado: null,
        })
        .where(eq(pagos_credito.pago_id, pago_id));
      return {
        data: {
          pago_id,
          credito_id,
          nuevoCapital: nuevoCapital.toString(),
          facturasAnuladas,
          facturasConError,
          numero_credito_sifco: creditData.numero_credito_sifco,
          cuota: creditData.cuota
        },
        completion: {
          reversalPath: "validated_payment" as const,
          processedCount: facturasDelPago.length,
          succeededCount: facturasAnuladas.length,
          failedCount: facturasConError.length,
        },
      };
    });

    dependencies.emitTerminal({
      outcome: result.completion.failedCount > 0 ? "partially_completed" : "completed",
      reversalPath: result.completion.reversalPath,
      processedCount: result.completion.processedCount,
      succeededCount: result.completion.succeededCount,
      failedCount: result.completion.failedCount,
      durationMs: elapsedMilliseconds(startedAt),
    });

    set.status = 200;
    return {
      message: "Payment reversed to pending successfully",
      data: result.data,
    };
  } catch (error: any) {
    const reasonCode = error?.message === "Payment not found"
      ? "payment_not_found"
      : error?.message === "Credit not found or not active"
        ? "credit_not_found"
        : null;
    if (reasonCode) {
      dependencies.emitTerminal({
        outcome: "rejected",
        reasonCode,
        durationMs: elapsedMilliseconds(startedAt),
      });
    } else {
      dependencies.emitTerminal({
        outcome: "failed",
        errorCode: "unknown",
        durationMs: elapsedMilliseconds(startedAt),
      });
    }

    if (error.message === "Payment not found") {
      set.status = 404;
    } else if (error.message === "Credit not found or not active") {
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

export const revertPaymentToPending = createRevertPaymentToPending();
