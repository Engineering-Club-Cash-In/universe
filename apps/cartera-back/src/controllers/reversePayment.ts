import { z } from "zod";  
 
import { eq, and, or } from "drizzle-orm";
import Big from "big.js"; 
import { db } from "../database";
import { pagos_credito, creditos, usuarios, cuotas_credito, boletas, pagos_credito_inversionistas } from "../database/db";
import { processAndReplaceCreditInvestorsReverse } from "./investor";
import { updateMora } from "./latefee";
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
export const reversePayment = async ({ body, set }: any) => {
  try {
    console.log("\n🔄 ========== INICIO REVERSIÓN DE PAGO ==========");

    // ========================================================================
    // 1️⃣ VALIDAR ENTRADA
    // ========================================================================
    const parseResult = reversePaymentSchema.safeParse(body);
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

    // ========================================================================
    // 2️⃣ OBTENER DATOS DEL PAGO A REVERSAR
    // ========================================================================
    const [pago] = await db
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
      set.status = 404;
      return { message: "Payment not found" };
    }

    if (!pago.pagado) {
      set.status = 400;
      return { message: "Payment is not marked as paid" };
    }

    console.log("✅ Pago encontrado y marcado como pagado");

    // ========================================================================
    // 3️⃣ OBTENER DATOS DEL CRÉDITO
    // ========================================================================
    const [creditData] = await db
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
      set.status = 404;
      return { message: "Credit not found or not active" };
    }

    console.log("✅ Crédito encontrado y activo");

    // ========================================================================
    // 4️⃣ OBTENER DATOS DEL USUARIO
    // ========================================================================
    const [user] = await db
      .select()
      .from(usuarios)
      .where(eq(usuarios.usuario_id, creditData.usuario_id))
      .limit(1);

    if (!user) {
      set.status = 404;
      return { message: "User not found" };
    }

    console.log("✅ Usuario encontrado");

    // ========================================================================
    // 5️⃣ RECALCULAR VALORES DEL CRÉDITO (devolver capital)
    // ========================================================================
    console.log("\n📊 ========== RECALCULANDO VALORES DEL CRÉDITO ==========");
    
    const capitalActual = new Big(creditData.capital ?? 0);
    const abonoCapital = new Big(pago.abono_capital ?? 0);
    const nuevoCapital = capitalActual.plus(abonoCapital);

    console.log(`💰 Capital actual: ${capitalActual.toString()}`);
    console.log(`💵 Abono capital a reversar: ${abonoCapital.toString()}`);
    console.log(`✅ Nuevo capital: ${nuevoCapital.toString()}`);

    // Recalcular interés e IVA basado en el nuevo capital
    const porcentajeInteres = new Big(creditData.porcentaje_interes ?? 0).div(100);
    const cuota_interes = nuevoCapital.times(porcentajeInteres).round(2);
    const iva_12 = cuota_interes.times(0.12).round(2);

    console.log(`🔢 Nuevo interés: ${cuota_interes.toString()}`);
    console.log(`🔢 Nuevo IVA: ${iva_12.toString()}`);

    // Recalcular deuda total
    const deudatotal = nuevoCapital
      .plus(cuota_interes)
      .plus(iva_12)
      .plus(creditData.seguro_10_cuotas ?? 0)
      .plus(creditData.gps ?? 0)
      .plus(creditData.membresias_pago ?? 0);

    console.log(`💳 Nueva deuda total: ${deudatotal.toString()}`);

    // ========================================================================
    // 6️⃣ REVERSAR MORA SI EXISTÍA
    // ========================================================================
    if (pago.mora && Number(pago.mora) > 0) {
      console.log(`⚠️ Reversando mora: ${pago.mora}`);
      await updateMora({
        credito_id,
        monto_cambio: Number(pago.mora),
        tipo: "INCREMENTO",
        activa: true,
      });
    }

    // ========================================================================
    // 7️⃣ ACTUALIZAR EL CRÉDITO CON LOS NUEVOS VALORES
    // ========================================================================
    await db
      .update(creditos)
      .set({
        capital: nuevoCapital.toString(),
        deudatotal: deudatotal.toString(),
        cuota_interes: cuota_interes.toString(),
        iva_12: iva_12.toString(),
      })
      .where(eq(creditos.credito_id, credito_id));

    console.log("✅ Crédito actualizado con nuevos valores");

    // ========================================================================
    // 8️⃣ REVERSAR INVERSIONES ASOCIADAS AL PAGO
    // ========================================================================
    console.log("\n💼 ========== REVERSANDO INVERSIONES ==========");
    await processAndReplaceCreditInvestorsReverse(
      credito_id,
      abonoCapital.toNumber(),
      true,
      pago_id
    );
    console.log("✅ Inversiones reversadas correctamente");

    // ========================================================================
    // 9️⃣ DEVOLVER ABONOS A LOS "RESTANTES" DEL PAGO
    // ========================================================================
    console.log("\n🔙 ========== DEVOLVIENDO ABONOS A RESTANTES ==========");

    const nuevoCapitalRestante = new Big(pago.capital_restante ?? 0)
      .plus(pago.abono_capital ?? 0);
    const nuevoInteresRestante = new Big(pago.interes_restante ?? 0)
      .plus(pago.abono_interes ?? 0);
    const nuevoIvaRestante = new Big(pago.iva_12_restante ?? 0)
      .plus(pago.abono_iva_12 ?? 0);
    const nuevoSeguroRestante = new Big(pago.seguro_restante ?? 0)
      .plus(pago.abono_seguro ?? 0);
    const nuevoGpsRestante = new Big(pago.gps_restante ?? 0)
      .plus(pago.abono_gps ?? 0);
    const nuevoMembresiasRestante = new Big(pago.membresias ?? 0)
      .plus(pago.membresias_pago ?? 0);

    console.log(`💵 Capital restante: ${pago.capital_restante} → ${nuevoCapitalRestante.toString()}`);
    console.log(`💵 Interés restante: ${pago.interes_restante} → ${nuevoInteresRestante.toString()}`);
    console.log(`💵 IVA restante: ${pago.iva_12_restante} → ${nuevoIvaRestante.toString()}`);
    console.log(`💵 Seguro restante: ${pago.seguro_restante} → ${nuevoSeguroRestante.toString()}`);
    console.log(`💵 GPS restante: ${pago.gps_restante} → ${nuevoGpsRestante.toString()}`);
    console.log(`💵 Membresías restante: ${pago.membresias} → ${nuevoMembresiasRestante.toString()}`);

    // ========================================================================
    // 🔟 ACTUALIZAR LA CUOTA ASOCIADA (marcar como NO pagada)
    // ========================================================================
    await db
      .update(cuotas_credito)
      .set({ pagado: false })
      .where(eq(cuotas_credito.cuota_id, pago.cuota_id));

    console.log("✅ Cuota marcada como NO pagada");

    // ========================================================================
    // 1️⃣1️⃣ RESETEAR EL PAGO (devolver a estado inicial)
    // ========================================================================
    console.log("\n🔄 ========== RESETEANDO VALORES DEL PAGO ==========");

    await db.update(pagos_credito)
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
        mora: "0",
        otros: "0",
        
        // Limpiar metadata
        fecha_pago: null,
        mes_pagado: "",
        pagado: false,
        observaciones: "",
        
        // Resetear facturación
        seguro_facturado: "0",
        gps_facturado: "0",
        reserva: "0",
        validationStatus:"no_required" as const
      })
      .where(eq(pagos_credito.pago_id, pago_id));

    console.log("✅ Pago reseteado correctamente");

    // ========================================================================
    // 1️⃣2️⃣ ELIMINAR BOLETAS ASOCIADAS
    // ========================================================================
    await db.delete(boletas).where(eq(boletas.pago_id, pago_id));
    console.log("✅ Boletas eliminadas");

    // ========================================================================
    // 1️⃣3️⃣ ELIMINAR PAGOS DE INVERSIONISTAS ASOCIADOS
    // ========================================================================
    await db
      .delete(pagos_credito_inversionistas)
      .where(eq(pagos_credito_inversionistas.pago_id, pago_id));
    console.log("✅ Pagos de inversionistas eliminados");

    // ========================================================================
    // 1️⃣4️⃣ ACTUALIZAR SALDO A FAVOR DEL USUARIO
    // ========================================================================
    console.log("\n💰 ========== ACTUALIZANDO SALDO A FAVOR ==========");
    
    const saldoActual = new Big(user.saldo_a_favor ?? 0);
    const montoBoleta = new Big(pago.monto_boleta ?? 0);
    let nuevoSaldoAFavor = saldoActual.minus(montoBoleta);

    // Si el saldo queda negativo, ponerlo en cero
    if (nuevoSaldoAFavor.lt(0)) {
      nuevoSaldoAFavor = new Big(0);
    }

    console.log(`💵 Saldo actual: ${saldoActual.toString()}`);
    console.log(`💵 Monto boleta: ${montoBoleta.toString()}`);
    console.log(`✅ Nuevo saldo a favor: ${nuevoSaldoAFavor.toString()}`);

    await db
      .update(usuarios)
      .set({ saldo_a_favor: nuevoSaldoAFavor.toString() })
      .where(eq(usuarios.usuario_id, user.usuario_id));

    console.log("✅ Saldo a favor actualizado");

    // ========================================================================
    // ✅ RETORNAR RESULTADO EXITOSO
    // ========================================================================
    console.log("\n✅ ========== REVERSIÓN COMPLETADA EXITOSAMENTE ==========\n");

    set.status = 200;
    return {
      message: "Payment reversed successfully",
      data: {
        reversedPaymentId: pago_id,
        updatedCredit: {
          credito_id: creditData.credito_id,
          capital: nuevoCapital.toString(),
          deudatotal: deudatotal.toString(),
          cuota_interes: cuota_interes.toString(),
          iva_12: iva_12.toString(),
        },
        updatedPayment: {
          pago_id,
          capital_restante: nuevoCapitalRestante.toString(),
          interes_restante: nuevoInteresRestante.toString(),
          iva_12_restante: nuevoIvaRestante.toString(),
          pagado: false,
        },
        updatedUser: {
          usuario_id: user.usuario_id,
          saldo_a_favor: nuevoSaldoAFavor.toString(),
        },
      },
    };

  } catch (error) {
    console.error("\n❌ ========== ERROR EN REVERSIÓN ==========");
    console.error("[reversePayment] Error:", error);
    console.error("========================================\n");
    
    set.status = 500;
    return {
      message: "Internal server error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
};