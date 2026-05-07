import { z } from "zod";
import { eq, and } from "drizzle-orm";
import Big from "big.js";
import { db } from "../database";
import { pagos_credito, creditos } from "../database/db";
import { insertPagosCreditoInversionistasV2 } from "./payments";

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
      
      if (pago.validationStatus === "validated") {
        throw new Error(`Payment ${pago_id} is already validated`);
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
      const todosPagosCuota = pago.cuota_id === null
        ? []
        : await tx
            .select({ abono_capital: pagos_credito.abono_capital })
            .from(pagos_credito)
            .where(
              and(
                eq(pagos_credito.cuota_id, pago.cuota_id),
                eq(pagos_credito.validationStatus, "validated")
              )
            );

      let abono_capital_total = new Big(0);
      for (const p of todosPagosCuota) {
        abono_capital_total = abono_capital_total.plus(p.abono_capital ?? 0);
      }

      // Incluir el abono del pago actual (aún no está "validated")
      abono_capital_total = abono_capital_total.plus(pago.abono_capital ?? 0);

      const nuevo_capital = capital_actual.minus(abono_capital_total);

      console.log(`💰 Capital actual: ${capital_actual.toString()}`);
      console.log(`💰 Abono capital total de cuota: ${abono_capital_total.toString()}`);
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
      await tx
        .update(pagos_credito)
        .set({ validationStatus: "validated", fecha_aplicado: new Date() })
        .where(eq(pagos_credito.pago_id, pago_id));
      console.log("✅ Pago marcado como validado con fecha de aplicación");

      return {
        pago_id,
        credito_id,
        nuevoCapital: nuevo_capital.toString(),
        numero_credito_sifco: credito.numero_credito_sifco,
        cuota: credito.cuota
      };
    });

    // 8️⃣ EJECUTAR INVERSIONISTAS (fuera de la transacción para usar la función existente o asegurar que los registros se vean en la otra conexión)
    // El insertPagosCreditoInversionistasV2 ya maneja su propia forma de inserción.
    // Ojo: insertPagosCreditoInversionistasV2 puede requerir validaciones internas.
    console.log("\n💼 ========== PROCESANDO INVERSIONISTAS ==========");
    await insertPagosCreditoInversionistasV2(pago_id, credito_id);
    console.log("✅ Pagos a inversionistas procesados correctamente");

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
    } else if (error.message.includes("already validated")) {
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
