import { z } from "zod";
import { eq, and, ne, sql } from "drizzle-orm";
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
import { PAYMENT_ADVISORY_LOCK_NAMESPACE } from "../utils/paymentAdvisoryLock";

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
export const revalidatePayment = async ({ body, set }: any) => {
  try {
    console.log("\n✅ ========== INICIO REVALIDACIÓN DE PAGO ==========");

    // 1️⃣ VALIDAR ENTRADA
    const parseResult = revalidatePaymentSchema.safeParse(body);
    if (!parseResult.success) {
      set.status = 400;
      return {
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      };
    }
    const { credito_id, pago_id } = parseResult.data;
    console.log(`📋 Crédito ID: ${credito_id}`);
    console.log(`🧾 Pago ID: ${pago_id}`);

    // 🔥 INICIAR TRANSACCIÓN ATÓMICA
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(${PAYMENT_ADVISORY_LOCK_NAMESPACE}, ${credito_id})`
      );
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
        throw new Error(`Payment ${pago_id} not found`);
      }
      
      if (esPagoAplicado(pago.validationStatus)) {
        throw new Error(`Payment ${pago_id} is already validated`);
      }
      if (pago.validationStatus !== "pending" || pago.paymentFalse !== false) {
        throw new Error(`Payment ${pago_id} is not pending revalidation`);
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

      console.log(`✅ Pago encontrado (Pendiente)`);

      // 3️⃣ OBTENER DATOS DEL CRÉDITO
      if (pago.credito_id === null) {
        throw new Error(`El pago ${pago_id} no tiene un crédito asociado`);
      }

      const [credito] = await tx
        .select()
        .from(creditos)
        .where(eq(creditos.credito_id, pago.credito_id))
        .limit(1);

      if (!credito) {
        throw new Error(`Crédito ${pago.credito_id} no encontrado`);
      }

      console.log("✅ Crédito encontrado");

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

      console.log(`💰 Capital actual: ${capital_actual.toString()}`);
      console.log(`💰 Abono capital del pago actual: ${abono_capital_actual.toString()}`);
      console.log(`💰 Nuevo capital: ${nuevo_capital.toString()}`);

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

      console.log(`🔢 Nueva cuota interés: ${cuota_interes.toString()}`);
      console.log(`🔢 Nuevo IVA 12%: ${iva_12.toString()}`);
      console.log(`📊 Nueva deuda total: ${nueva_deuda_total.toString()}`);

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
        console.log("✅ Crédito actualizado con nuevos valores");
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
        throw new Error(`Payment ${pago_id} changed during revalidation`);
      }
      console.log("✅ Pago marcado como validado con fecha de aplicación");

      if (pago.cuota_id !== null && coberturaCuota.cuotaCompleta) {
        await tx
          .update(cuotas_credito)
          .set({ pagado: true })
          .where(eq(cuotas_credito.cuota_id, pago.cuota_id));
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
        cuota: credito.cuota
      };
    });

    if ("success" in result && result.success === false) {
      set.status = 400;
      return result;
    }

    set.status = 200;
    return {
      message: "Payment revalidated successfully",
      data: result,
    };
  } catch (error: any) {
    console.error("\n❌ ========== ERROR EN REVALIDACIÓN ==========");
    console.error(error);
    
    if (error.message.includes("not found")) {
      set.status = 404;
    } else if (
      error.message.includes("already validated") ||
      error.message.includes("not pending revalidation") ||
      error.message.includes("changed during revalidation")
    ) {
      set.status = 409;
    } else {
      set.status = 500;
    }

    return {
      message: "Internal server error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
};
