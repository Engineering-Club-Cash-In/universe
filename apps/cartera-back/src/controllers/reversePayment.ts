import { z } from "zod";

import { eq, and, or, not, inArray, sql } from "drizzle-orm";
import Big from "big.js";
import { db } from "../database";
import {
  pagos_credito,
  creditos,
  usuarios,
  cuotas_credito,
  boletas,
  pagos_credito_inversionistas,
  convenios_pago,
  facturas_electronicas,
} from "../database/db";
import { processAndReplaceCreditInvestorsReverse } from "./investor";
import { updateMora } from "./latefee";
import { SATClientService } from "../cofidi/satClientService";
import { CLUB_CASHIN_CONFIG, SAT_CONFIG } from "../utils/functions/const";
import { updateInstallments } from "./updateCredit";
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
    // 🔥 INICIAR TRANSACCIÓN ATÓMICA
    // ========================================================================
    const result = await db.transaction(async (tx) => {
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

      const pagoValidado = pago.validationStatus === "validated";

      console.log(`✅ Pago encontrado | Validado: ${pagoValidado}`);

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
            or(
              eq(creditos.statusCredit, "ACTIVO"),
              eq(creditos.statusCredit, "MOROSO"),
              eq(creditos.statusCredit, "EN_CONVENIO"),
            ),
          ),
        )
        .limit(1);

      if (!creditData) {
        throw new Error("Credit not found or not active");
      }

      console.log("✅ Crédito encontrado y activo");

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

      console.log("✅ Usuario encontrado");

      // ======================================================================
      // 5️⃣ RECALCULAR VALORES DEL CRÉDITO (solo si cuota está pagada)
      // ======================================================================
      let nuevoCapital = new Big(creditData.creditos.capital ?? 0);
      let cuota_interes = new Big(creditData.creditos.cuota_interes ?? 0);
      let iva_12 = new Big(creditData.creditos.iva_12 ?? 0);
      let deudatotal = new Big(creditData.creditos.deudatotal ?? 0);

      if (pagoValidado) {
        console.log(
          "\n📊 ========== RECALCULANDO VALORES DEL CRÉDITO ==========",
        );

        const capitalActual = new Big(creditData.creditos.capital ?? 0);
        const abonoCapital = new Big(pago.abono_capital ?? 0);
        nuevoCapital = capitalActual.plus(abonoCapital);

        console.log(`💰 Capital actual: ${capitalActual.toString()}`);
        console.log(`💵 Abono capital a reversar: ${abonoCapital.toString()}`);
        console.log(`✅ Nuevo capital: ${nuevoCapital.toString()}`);

        // Recalcular interés e IVA basado en el nuevo capital
        const porcentajeInteres = new Big(
          creditData.creditos.porcentaje_interes ?? 0,
        ).div(100);
        cuota_interes = nuevoCapital.times(porcentajeInteres).round(2);
        iva_12 = cuota_interes.times(0.12).round(2);

        console.log(`🔢 Nuevo interés: ${cuota_interes.toString()}`);
        console.log(`🔢 Nuevo IVA: ${iva_12.toString()}`);

        // Recalcular deuda total
        deudatotal = nuevoCapital
          .plus(cuota_interes)
          .plus(iva_12)
          .plus(creditData.creditos.seguro_10_cuotas ?? 0)
          .plus(creditData.creditos.gps ?? 0)
          .plus(creditData.creditos.membresias_pago ?? 0);

        console.log(`💳 Nueva deuda total: ${deudatotal.toString()}`);
      } else {
        console.log("⏭️ Cuota no pagada — se omite recálculo de capital/interés/IVA");
      }

      // ======================================================================
      // 6️⃣ REVERSAR MORA SI EXISTÍA
      // ======================================================================
      if (pago.mora && Number(pago.mora) > 0) {
        console.log(`⚠️ Reversando mora: ${pago.mora}`);
        await updateMora({
          credito_id,
          monto_cambio: Number(pago.mora),
          tipo: "INCREMENTO",
          activa: true,
        });
      }

      // ======================================================================
      // 6️⃣.5️⃣ REVERSAR PAGO DE CONVENIO SI EXISTÍA
      // ======================================================================
      if (pago.pagoConvenio && Number(pago.pagoConvenio) > 0) {
        console.log(`⚠️ Reversando pago de convenio: ${pago.pagoConvenio}`);
        const reverseConvenioResult = await reverseConvenioPayment({
          credito_id,
          monto_pago: Number(pago.pagoConvenio),
        });
        console.log(
          `✅ Pago de convenio reversado: ${reverseConvenioResult.message}`,
        );
      }

      // ======================================================================
      // 7️⃣ ACTUALIZAR EL CRÉDITO CON LOS NUEVOS VALORES
      // ======================================================================
      if (pagoValidado) {
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
      } else {
        console.log(`⏭️ Crédito NO actualizado (pagoValidado=${pagoValidado})`);
      }

      // ======================================================================
      // 8️⃣ REVERSAR INVERSIONES ASOCIADAS AL PAGO
      // ======================================================================
      console.log("\n💼 ========== REVERSANDO INVERSIONES ==========");
      await processAndReplaceCreditInvestorsReverse(
        credito_id,
        pago_id,
      );
      console.log("✅ Inversiones reversadas correctamente");

      // ======================================================================
      // 9️⃣ DEVOLVER ABONOS A LOS "RESTANTES" DEL PAGO
      // ======================================================================
      console.log("\n🔙 ========== DEVOLVIENDO ABONOS A RESTANTES ==========");

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

      console.log(
        `💵 Capital restante: ${pago.capital_restante} → ${nuevoCapitalRestante.toString()}`,
      );
      console.log(
        `💵 Interés restante: ${pago.interes_restante} → ${nuevoInteresRestante.toString()}`,
      );
      console.log(
        `💵 IVA restante: ${pago.iva_12_restante} → ${nuevoIvaRestante.toString()}`,
      );
      console.log(
        `💵 Seguro restante: ${pago.seguro_restante} → ${nuevoSeguroRestante.toString()}`,
      );
      console.log(
        `💵 GPS restante: ${pago.gps_restante} → ${nuevoGpsRestante.toString()}`,
      );
      console.log(
        `💵 Membresías restante: ${pago.membresias} → ${nuevoMembresiasRestante.toString()}`,
      );

      // ======================================================================
      // 🔟 ACTUALIZAR LA CUOTA ASOCIADA (marcar como NO pagada)
      // ======================================================================
      const pagoEstabaPagado = pago.pagado === true;
      if (pagoEstabaPagado) {
        // Si el pago SÍ estaba pagado, actualizamos la cuota y reseteamos el pago
        console.log(
          "📝 Pago estaba PAGADO - Marcando cuota como NO pagada y reseteando pago",
        );

        if (pago.cuota_id !== null) {
          await tx
            .update(cuotas_credito)
            .set({ pagado: false })
            .where(eq(cuotas_credito.cuota_id, pago.cuota_id));
        }

        console.log("✅ Cuota marcada como NO pagada");

        // ======================================================================
        // 1️⃣1️⃣ RESETEAR EL PAGO (devolver a estado inicial)
        // ======================================================================
        console.log("\n🔄 ========== RESETEANDO VALORES DEL PAGO ==========");

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
          })
          .where(eq(pagos_credito.pago_id, pago_id));

        console.log(
          "✅ Pago reseteado correctamente (mantiene registro histórico)",
        );
        await tx.delete(boletas).where(eq(boletas.pago_id, pago_id));
        console.log("✅ Boletas eliminadas");
      } else {
        // Pago parcial - verificar si es el único registro de la cuota
        const cantidadPagos = pago.cuota_id === null
          ? 0
          : (await tx
              .select({ count: sql<number>`COUNT(*)` })
              .from(pagos_credito)
              .where(eq(pagos_credito.cuota_id, pago.cuota_id)))[0].count;

        await tx.delete(boletas).where(eq(boletas.pago_id, pago_id));
        console.log("✅ Boletas eliminadas");
        await tx
          .delete(pagos_credito_inversionistas)
          .where(eq(pagos_credito_inversionistas.pago_id, pago_id));
        console.log("✅ Pagos inversionistas eliminados");

        if (Number(cantidadPagos) > 1) {
          // Hay más registros, se puede eliminar este
          await tx
            .delete(pagos_credito)
            .where(eq(pagos_credito.pago_id, pago_id));
          console.log("✅ Pago parcial eliminado (quedan otros registros en la cuota)");
        } else {
          // Es el único registro, resetear en vez de eliminar
          console.log("⚠️ Único registro de la cuota, reseteando en vez de eliminar");
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
            })
            .where(eq(pagos_credito.pago_id, pago_id));
          console.log("✅ Pago reseteado (registro conservado para la cuota)");
        }
      }
      console.log("✅ Pago reseteado correctamente");

      // ======================================================================
      // 1️⃣2️⃣ ELIMINAR BOLETAS ASOCIADAS
      // ======================================================================

      // ======================================================================
      // 1️⃣2️⃣.5️⃣ 🆕 ANULAR FACTURAS ELECTRÓNICAS ASOCIADAS AL PAGO
      // ======================================================================
      console.log("\n🧾 ========== ANULANDO FACTURAS ELECTRÓNICAS ==========");

      // Buscar facturas activas de este pago
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

      console.log(
        `📊 Se encontraron ${facturasDelPago.length} factura(s) activa(s)`,
      );

      const facturasAnuladas = [];
      const facturasConError = [];

      if (facturasDelPago.length > 0) {
        for (const factura of facturasDelPago) {
          console.log(
            `\n🧾 Procesando factura ${factura.serie}-${factura.numero} (${factura.uuid})`,
          );

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
              await tx
                .update(facturas_electronicas)
                .set({
                  status: "ANULADA",
                  fecha_anulacion: new Date(),
                  motivo_anulacion: `Reversión automática del pago ID: ${pago_id}`,
                  anulada_por: creditData.creditos.usuario_id || null,
                })
                .where(
                  eq(facturas_electronicas.factura_id, factura.factura_id),
                );

              console.log(
                `   ✅ Factura ${factura.serie}-${factura.numero} anulada correctamente`,
              );

              facturasAnuladas.push({
                factura_id: factura.factura_id,
                uuid: factura.uuid,
                serie: factura.serie,
                numero: factura.numero,
              });
            } catch (dbError: any) {
              console.error(
                `   ⚠️ Error al actualizar BD (factura YA anulada en COFIDI):`,
                dbError.message,
              );

              facturasConError.push({
                factura_id: factura.factura_id,
                uuid: factura.uuid,
                error: "BD_UPDATE_ERROR",
                mensaje: "Anulada en COFIDI pero error al actualizar BD",
              });
            }
          } else {
            console.error(
              `   ❌ Error al anular en COFIDI:`,
              resultadoCofidi.mensaje,
            );

            facturasConError.push({
              factura_id: factura.factura_id,
              uuid: factura.uuid,
              error: resultadoCofidi.error,
              mensaje: resultadoCofidi.mensaje,
            });
          }
        }

        console.log(`\n📊 Resumen anulación facturas:`);
        console.log(`   ✅ Anuladas: ${facturasAnuladas.length}`);
        console.log(`   ❌ Con error: ${facturasConError.length}`);
      }

      // ======================================================================
      // 1️⃣3️⃣ ELIMINAR PAGOS DE INVERSIONISTAS ASOCIADOS
      // ======================================================================
      await tx
        .delete(pagos_credito_inversionistas)
        .where(eq(pagos_credito_inversionistas.pago_id, pago_id));
      console.log("✅ Pagos de inversionistas eliminados");

      // ======================================================================
      // 1️⃣4️⃣ ACTUALIZAR SALDO A FAVOR DEL USUARIO
      // ======================================================================
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

      await tx
        .update(usuarios)
        .set({ saldo_a_favor: nuevoSaldoAFavor.toString() })
        .where(eq(usuarios.usuario_id, user.usuario_id));

      console.log("✅ Saldo a favor actualizado");

      // ======================================================================
      // 1️⃣5️⃣ LIMPIAR PAGOS DUPLICADOS DE LA MISMA CUOTA
      // ======================================================================
      let pagosDuplicados: { pago_id: number }[] = [];

      if (pagoEstabaPagado) {
        console.log("\n🧹 ========== LIMPIANDO PAGOS DUPLICADOS ==========");

        // Primero obtener los IDs de pagos duplicados
        const pagosDuplicadosIds = pago.cuota_id === null
          ? []
          : await tx
              .select({ pago_id: pagos_credito.pago_id })
              .from(pagos_credito)
              .where(
                and(
                  eq(pagos_credito.cuota_id, pago.cuota_id),
                  eq(pagos_credito.credito_id, credito_id),
                  not(eq(pagos_credito.pago_id, pago_id))
                )
              );

        const ids = pagosDuplicadosIds.map((p) => p.pago_id);

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

        console.log(`🗑️ Pagos duplicados eliminados: ${pagosDuplicados.length}`);
      } else {
        console.log("\n⏭️ Pago eliminado - no se limpian duplicados");
      }

      // ======================================================================
      // ✅ RETORNAR DATOS DE LA TRANSACCIÓN
      // ======================================================================
      return {
        pago,
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
        facturasAnuladas,
        facturasConError,
        totalFacturas: facturasDelPago.length,
      };
    });
try {
  await updateInstallments({
    numero_credito_sifco: result.creditData.creditos.numero_credito_sifco, 
    nueva_cuota: Number(result.creditData.creditos.cuota),  
    all: true
  });
  
  console.log("✅ UPDATE ALL STATEMENT ejecutado correctamente");
} catch (updateError: any) {
  console.error("⚠️ Error en UPDATE ALL STATEMENT:", updateError.message);
  // NO hacer throw aquí porque la transacción ya se completó
}
    // ========================================================================
    // ✅ TRANSACCIÓN COMPLETADA - RETORNAR RESULTADO EXITOSO
    // ========================================================================
    console.log(
      "\n✅ ========== REVERSIÓN COMPLETADA EXITOSAMENTE ==========\n",
    );

    set.status = 200;
    return {
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
        // 🆕 Info de facturas anuladas
        facturas:
          result.totalFacturas > 0
            ? {
                total: result.totalFacturas,
                anuladas: result.facturasAnuladas.length,
                con_error: result.facturasConError.length,
                detalles: {
                  anuladas: result.facturasAnuladas,
                  errores: result.facturasConError,
                },
              }
            : undefined,
      },
    };
  } catch (error: any) {
    console.error("\n❌ ========== ERROR EN REVERSIÓN ==========");
    console.error("[reversePayment] Error:", error);
    console.error("========================================\n");

    // Determinar status code según el tipo de error
    if (error.message === "Payment not found") {
      set.status = 404;
    } else if (
      error.message === "Payment is not marked as paid" ||
      error.message === "Credit not found or not active" ||
      error.message === "User not found"
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

    console.log("\n🔄 ========== REVIRTIENDO PAGO DE CONVENIO ==========");
    console.log("🏦 Crédito ID:", credito_id);
    console.log("💵 Monto a revertir:", monto_pago);

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

    console.log("📋 Convenio ID encontrado:", convenio.convenio_id);

    // 2. Convertir valores a Big.js
    const montoPagoBig = new Big(monto_pago);
    const cuotaMensualBig = new Big(convenio.cuota_mensual);
    const montoPagadoActualBig = new Big(convenio.monto_pagado);
    const montoPendienteActualBig = new Big(convenio.monto_pendiente);

    console.log("💵 Monto a revertir:", montoPagoBig.toString());

    // 3. RESTAR del monto pagado (reversa)
    const nuevoMontoPagadoBig = montoPagadoActualBig.minus(montoPagoBig);

    // 4. SUMAR al monto pendiente (reversa)
    const nuevoMontoPendienteBig = montoPendienteActualBig.plus(montoPagoBig);

    // Validar que no quede negativo
    if (nuevoMontoPagadoBig.lt(0)) {
      throw new Error("No se puede revertir más de lo que se ha pagado");
    }

    console.log("📊 Monto pagado anterior:", montoPagadoActualBig.toString());
    console.log("📊 Monto pagado nuevo:", nuevoMontoPagadoBig.toString());
    console.log(
      "📊 Monto pendiente anterior:",
      montoPendienteActualBig.toString(),
    );
    console.log("📊 Monto pendiente nuevo:", nuevoMontoPendienteBig.toString());

    // 5. Recalcular cuántas cuotas completas se han pagado
    const cuotasCompletasPagadas = nuevoMontoPagadoBig
      .div(cuotaMensualBig)
      .round(0, Big.roundDown);
    const nuevosPagosRealizados = parseInt(cuotasCompletasPagadas.toString());
    const nuevosPagosPendientes = convenio.numero_meses - nuevosPagosRealizados;

    console.log(
      "✅ Cuotas completas pagadas (después de reversa):",
      nuevosPagosRealizados,
    );
    console.log(
      "⬇️ Cuotas pendientes (después de reversa):",
      nuevosPagosPendientes,
    );

    // 6. El convenio ya NO está completado si se revirtió un pago
    const convenioCompletado = nuevoMontoPendienteBig.lte(0);
    const convenioActivo = !convenioCompletado;

    console.log("🔓 Convenio reactivado:", convenioActivo);

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

    console.log("🔄 ========== FIN REVERSIÓN DE PAGO ==========\n");

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
    console.error("Error revirtiendo pago de convenio:", error);
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

    console.log("🚫 Anulando factura en COFIDI:", uuid);

    // 1️⃣ CONSTRUIR XML DE ANULACIÓN
    const fechaEmisionDocumento = factura.fecha_certificacion
      ? new Date(factura.fecha_certificacion).toISOString()
      : factura.fecha_emision
        ? new Date(factura.fecha_emision).toISOString()
        : new Date().toISOString();

    const fechaHoraAnulacion = new Date().toISOString();

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

    console.log("📄 XML construido:", {
      uuid,
      nit_receptor: factura.receptor_nit,
      fecha_usada: fechaEmisionDocumento,
      motivo,
    });

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
      console.error("❌ Error en COFIDI:", resultado.descripcion);
      return {
        success: false,
        anulado: false,
        error: "COFIDI_ERROR",
        mensaje: resultado.descripcion || "Error desconocido en COFIDI",
      };
    }

    console.log("✅ Factura anulada en COFIDI");
    return {
      success: true,
      anulado: true,
      descripcion: resultado.descripcion,
      processor: resultado.processor,
    };
  } catch (error: any) {
    console.error("❌ Error al anular en COFIDI:", error);
    return {
      success: false,
      anulado: false,
      error: "EXCEPTION",
      mensaje: error.message || "Error desconocido",
    };
  }
}
