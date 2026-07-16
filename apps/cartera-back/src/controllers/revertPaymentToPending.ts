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
async function reverseAndCleanInvestors(tx: any, credito_id: number, pago_id: number) {
  console.log("\n💼 ========== REVERSANDO INVERSIONES ==========");
  await processAndReplaceCreditInvestorsReverse(credito_id, pago_id);
  
  await tx
    .delete(pagos_credito_inversionistas)
    .where(eq(pagos_credito_inversionistas.pago_id, pago_id));
  console.log("✅ Inversiones reversadas y eliminadas de BD");
}

// ============================================================================
// FUNCIÓN PRINCIPAL: PASAR PAGO A PENDIENTE
// ============================================================================
export const revertPaymentToPending = async ({ body, set }: any) => {
  try {
    console.log("\n🔄 ========== INICIO REVERSIÓN A PENDIENTE ==========");

    // 1️⃣ VALIDAR ENTRADA
    const parseResult = revertPaymentToPendingSchema.safeParse(body);
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
        throw new Error("Payment not found");
      }

      const pagoValidado = pago.validationStatus === "validated";
      console.log(`✅ Pago encontrado | Validado: ${pagoValidado}`);

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

      console.log("✅ Crédito encontrado y activo");

      // Ojo: acá NO se revierten los abonos a capital del espejo. `pagoValidado`
      // solo reconoce `validated`, así que un `capital_validated` cae en el
      // early-return de abajo sin devolver el capital ni cambiar de estado;
      // borrarle los abonos antes lo dejaría a medias (abono borrado + pago
      // todavía aplicado). Los pagos que esta ruta sí maneja (cuotas normales)
      // nunca generan abonos, así que no hay nada que revertir.
      // El reverso del abono vive en reversePayment.ts, que usa esPagoAplicado
      // y sí reconoce los abonos directos a capital.

      if (!pagoValidado) {
        console.log("ℹ️ El pago ya está en estado PENDIENTE. Solo se reversarán las inversiones.");
        
        await reverseAndCleanInvestors(tx, credito_id, pago_id);

        return {
          pago_id,
          credito_id,
          numero_credito_sifco: creditData.numero_credito_sifco,
          cuota: creditData.cuota,
          message: "Inversiones reversadas exitosamente (el pago ya estaba pendiente)"
        };
      }

      // 4️⃣ RECALCULAR VALORES DEL CRÉDITO
      let nuevoCapital = new Big(creditData.capital ?? 0);
      let cuota_interes = new Big(creditData.cuota_interes ?? 0);
      let iva_12 = new Big(creditData.iva_12 ?? 0);
      let deudatotal = new Big(creditData.deudatotal ?? 0);

      if (pagoValidado) {
        console.log("\n📊 ========== RECALCULANDO VALORES DEL CRÉDITO ==========");

        const capitalActual = new Big(creditData.capital ?? 0);
        const abonoCapital = new Big(pago.abono_capital ?? 0);
        nuevoCapital = capitalActual.plus(abonoCapital);

        console.log(`💰 Capital actual: ${capitalActual.toString()}`);
        console.log(`💵 Abono capital a reversar: ${abonoCapital.toString()}`);
        console.log(`✅ Nuevo capital: ${nuevoCapital.toString()}`);

        const porcentajeInteres = new Big(creditData.porcentaje_interes ?? 0).div(100);
        cuota_interes = nuevoCapital.times(porcentajeInteres).round(2);
        iva_12 = cuota_interes.times(0.12).round(2);

        console.log(`🔢 Nuevo interés: ${cuota_interes.toString()}`);
        console.log(`🔢 Nuevo IVA: ${iva_12.toString()}`);

        deudatotal = nuevoCapital
          .plus(cuota_interes)
          .plus(iva_12)
          .plus(creditData.seguro_10_cuotas ?? 0)
          .plus(creditData.gps ?? 0)
          .plus(creditData.membresias_pago ?? 0);

        console.log(`💳 Nueva deuda total: ${deudatotal.toString()}`);

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

        console.log("✅ Crédito actualizado con nuevos valores");
      }

      // 5️⃣ REVERTIR Y ELIMINAR INVERSIONES
      await reverseAndCleanInvestors(tx, credito_id, pago_id);

      // 6️⃣ ANULAR FACTURAS ELECTRÓNICAS
      console.log("\n🧾 ========== ANULANDO FACTURAS ELECTRÓNICAS ==========");
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
          console.log(`\n🧾 Procesando factura ${factura.serie}-${factura.numero} (${factura.uuid})`);

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

              console.log(`✅ Factura ${factura.serie}-${factura.numero} anulada correctamente`);
              
              facturasAnuladas.push({
                factura_id: factura.factura_id,
                uuid: factura.uuid,
                serie: factura.serie,
                numero: factura.numero,
              });
            } catch (dbError: any) {
              console.error(`⚠️ Error al actualizar BD:`, dbError.message);
              facturasConError.push({
                factura_id: factura.factura_id,
                uuid: factura.uuid,
                error: "BD_UPDATE_ERROR",
                mensaje: "Anulada en COFIDI pero error al actualizar BD",
              });
            }
           } else {
             console.error(`❌ Error al anular en COFIDI:`, resultadoCofidi.mensaje);
             facturasConError.push({
               factura_id: factura.factura_id,
               uuid: factura.uuid,
               error: resultadoCofidi.error,
               mensaje: resultadoCofidi.mensaje,
             });
          }
        }
        console.log(`\n📊 Resumen anulación facturas: ✅ Anuladas: ${facturasAnuladas.length} | ❌ Con error: ${facturasConError.length}`);
      }

      // 7️⃣ ACTUALIZAR ESTADO DEL PAGO A PENDING Y ANULAR FECHA
      console.log("\n🔄 ========== ACTUALIZANDO ESTADO DEL PAGO ==========");
      await tx
        .update(pagos_credito)
        .set({
          validationStatus: "pending",
          fecha_aplicado: null,
        })
        .where(eq(pagos_credito.pago_id, pago_id));
      console.log("✅ Pago marcado como pending y fecha_aplicado anulada");

      return {
        pago_id,
        credito_id,
        nuevoCapital: nuevoCapital.toString(),
        facturasAnuladas,
        facturasConError,
        numero_credito_sifco: creditData.numero_credito_sifco,
        cuota: creditData.cuota
      };
    });

    set.status = 200;
    return {
      message: "Payment reversed to pending successfully",
      data: result,
    };
  } catch (error: any) {
    console.error("\n❌ ========== ERROR EN REVERSIÓN A PENDIENTE ==========");
    console.error(error);
    
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
