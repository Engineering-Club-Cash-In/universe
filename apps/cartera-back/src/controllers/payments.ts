import { db } from "../database/index";
import {
  creditos,
  pagos_credito,
  usuarios,
  inversionistas,
  creditos_inversionistas,
  pagos_credito_inversionistas,
  boletas,
  cuotas_credito,
} from "../database/db/schema";
import { desc } from "drizzle-orm";
import Big from "big.js";
import { z } from "zod";
import { and, eq, lt, sql, asc, lte, inArray } from "drizzle-orm";
import {
  processAndReplaceCreditInvestors,
  processAndReplaceCreditInvestorsReverse,
} from "./investor";
import { updateMora } from "./latefee";

export const pagoSchema = z.object({
  credito_id: z.number().int().positive(),
  usuario_id: z.number().int().positive(),
  monto_boleta: z.number().min(0.01),
  fecha_pago: z.string(),
  llamada: z.string().max(100).optional(),
  renuevo_o_nuevo: z.string().max(50).optional(),
  otros: z.number().optional(),
  mora: z.number().optional(),
  monto_boleta_cuota: z.number().optional(),
  abono_directo_capital: z.number().optional(),

  observaciones: z.string().max(500).optional(),
  credito_sifco: z.string().max(50).optional(),
  cuotaApagar: z.number().min(1),
  url_boletas: z.array(z.string().max(500)),
});

export const reversePaymentSchema = z.object({
  credito_id: z.number().int().positive(),
  pago_id: z.number().int().positive(),
});

/**
 * Reverses a payment for a credit:
 * - Validates input
 * - Fetches and checks payment and credit data
 * - Updates the credit values (capital, debt, etc.)
 * - Sets the payment as not paid and resets its values
 *
 * @param body - Request body with credito_id and pago_id
 * @param set - Response handler (e.g., to set status)
 * @returns Detailed result object
 */
export const reversePayment = async ({ body, set }: any) => {
  try {
    // 1. Validate input
    const parseResult = reversePaymentSchema.safeParse(body);
    if (!parseResult.success) {
      set.status = 400;
      return {
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      };
    }
    const { credito_id, pago_id } = parseResult.data;

    // 2. Fetch payment to reverse
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

    // 3. Fetch credit data
    const [creditData] = await db
      .select()
      .from(creditos)
      .where(
        and(
          eq(creditos.credito_id, credito_id),
          eq(creditos.statusCredit, "ACTIVO")
        )
      );
    if (!creditData) {
      set.status = 404;
      return { message: "Credit not found" };
    }
    const [user] = await db
      .select()
      .from(usuarios)
      .where(eq(usuarios.usuario_id, creditData.usuario_id))
      .limit(1);
    // 4. Recalculate credit values (using Big.js for money calculations)
    const nuevoCapital = new Big(creditData.capital).add(
      pago.abono_capital ?? 0
    );
    const cuota_interes = new Big(nuevoCapital)
      .times(new Big(creditData.porcentaje_interes).div(100))
      .round(2);
    const iva_12 = cuota_interes.times(0.12).round(2);
    const deudatotal = new Big(nuevoCapital)
      .plus(cuota_interes)
      .plus(iva_12)
      .plus(creditData.seguro_10_cuotas ?? 0)
      .plus(creditData.gps ?? 0)
      .plus(creditData.membresias_pago ?? 0);
    if (pago.mora && Number(pago.mora) > 0) {
      await updateMora({
        credito_id,
        monto_cambio: Number(pago.mora),
        tipo: "INCREMENTO",
        activa: true,
      });
    }
    // 5. Update the credit record with new values
    await db
      .update(creditos)
      .set({
        capital: nuevoCapital.toString(),
        deudatotal: deudatotal.toString(),
        cuota_interes: cuota_interes.toString(),
        iva_12: iva_12.toString(),
      })
      .where(eq(creditos.credito_id, credito_id));
    const abonoBig = new Big(pago.abono_capital ?? 0);
    await processAndReplaceCreditInvestorsReverse(
      credito_id,
      abonoBig.toNumber(),
      true,
      pago_id
    );

    // 6. Reset the payment record
    await db
      .update(cuotas_credito)
      .set({ pagado: false })
      .where(eq(cuotas_credito.cuota_id, pago.cuota_id));
    await db
      .update(pagos_credito)
      .set({
        credito_id: creditData.credito_id,
        cuota: creditData.cuota,
        cuota_interes: creditData.cuota_interes,

        abono_capital: "0",
        abono_interes: "0",
        abono_iva_12: "0",
        abono_interes_ci: "0",
        abono_iva_ci: "0",
        abono_seguro: creditData.seguro_10_cuotas ? "0" : undefined,
        abono_gps: creditData.gps ? "0" : undefined,
        pago_del_mes: "0",
        monto_boleta: "0",

        capital_restante: nuevoCapital.toString(),
        interes_restante: creditData.cuota_interes,
        iva_12_restante: creditData.iva_12,
        seguro_restante: creditData.seguro_10_cuotas?.toString() ?? "0",
        gps_restante: creditData.gps?.toString() ?? "0",
        total_restante: creditData.deudatotal,

        membresias: creditData.membresias,
        membresias_pago: creditData.membresias_pago?.toString() ?? "",
        membresias_mes: creditData.membresias?.toString() ?? "",
        otros: "",
        mora: "0",
        monto_boleta_cuota: "0",
        seguro_total: creditData.seguro_10_cuotas?.toString() ?? "0",
        pagado: false,
        facturacion: "si", // default
        mes_pagado: "", // cleared until paid
        seguro_facturado: creditData.seguro_10_cuotas?.toString() ?? "0",
        gps_facturado: creditData.gps?.toString() ?? "0",
        reserva: "0",
        observaciones: "",
      })
      .where(eq(pagos_credito.pago_id, pago_id));

    // Eliminar las boletas asociadas a este pago
    await db.delete(boletas).where(eq(boletas.pago_id, pago_id));
    // Eliminar el pago de inversionistas asociado a este pago
    await db
      .delete(pagos_credito_inversionistas)
      .where(eq(pagos_credito_inversionistas.pago_id, pago_id));

    let saldo_a_favor = new Big(user.saldo_a_favor ?? 0).minus(
      pago.monto_boleta ?? 0
    );
    if (saldo_a_favor.lt(0)) {
      saldo_a_favor = new Big(0);
    }
    await db
      .update(usuarios)
      .set({ saldo_a_favor: saldo_a_favor.toString() })
      .where(eq(usuarios.usuario_id, user.usuario_id));
    // 7. Return elegant result
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
      },
    };
  } catch (error) {
    console.error("[reversePayment] Error:", error);
    set.status = 500;
    return {
      message: "Internal server error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const insertPayment = async ({ body, set }: any) => {
  try {
    const parseResult = pagoSchema.safeParse(body);
    if (!parseResult.success) {
      set.status = 400;
      return {
        message: "Validation failed",
        errors: parseResult.error.flatten().fieldErrors,
      };
    }

    const {
      credito_id,
      usuario_id,
      monto_boleta,
      fecha_pago,
      llamada,
      renuevo_o_nuevo,
      otros,
      mora,
      observaciones,
      abono_directo_capital,
      cuotaApagar,
      url_boletas,
    } = parseResult.data;
    console.log("monto_boleta", monto_boleta);
    const r2BaseUrl = import.meta.env.URL_PUBLIC_R2;
    const urlCompletas = url_boletas.map(
      (url_boleta) => `${r2BaseUrl}${url_boleta}`
    );
    const now = new Date();
    const mes_pagado = `${now.getFullYear()}-${String(
      now.getMonth() + 1
    ).padStart(2, "0")}`;

    const [credito] = await db
      .select()
      .from(creditos)
      .where(
        and(
          eq(creditos.credito_id, credito_id),
          eq(creditos.statusCredit, "ACTIVO")
        )
      )
      .limit(1);
    if (!credito) {
      set.status = 404;
      return { message: "Credit not found" };
    }
    const fechaInicio = new Date(credito.fecha_creacion);
    const hoy = new Date();

    const mesesTranscurridos =
      (hoy.getFullYear() - fechaInicio.getFullYear()) * 12 +
      (hoy.getMonth() - fechaInicio.getMonth()) +
      1;
    let cuotasPendientes = await db
      .select()
      .from(cuotas_credito)
      .where(
        and(
          eq(cuotas_credito.credito_id, credito_id),
          lte(cuotas_credito.numero_cuota, cuotaApagar), // 👈 Cuotas hasta la actual
          eq(cuotas_credito.pagado, false)
        )
      )
      .orderBy(asc(cuotas_credito.numero_cuota));
    console.log("cuotasPendientes", cuotasPendientes);
    const inversionistasCredito = await db
      .select()
      .from(creditos_inversionistas)
      .where(eq(creditos_inversionistas.credito_id, credito_id));

    const [usuario] = await db
      .select({ saldo_a_favor: usuarios.saldo_a_favor })
      .from(usuarios)
      .where(eq(usuarios.usuario_id, usuario_id));

    if (!usuario) {
      set.status = 404;
      return { message: "User not found" };
    }

    const saldoAFavor = new Big(usuario.saldo_a_favor ?? 0);
    const montoBoleta = new Big(monto_boleta);
    const moraBig = new Big(mora ?? 0);
    const otrosBig = new Big(otros ?? 0);
    const montoEfectivo = montoBoleta
      .minus(moraBig)
      .minus(otrosBig)
      .minus(abono_directo_capital ?? 0);
    let disponible = saldoAFavor.plus(montoEfectivo);
    console.log("disponible", disponible.toString());
    const pagosRealizados = [];

    if (cuotasPendientes.length === 0) {
      // Si no hay cuotas pendientes, revisamos si hay mora y/o otros a pagar
      if (moraBig.gt(0) || otrosBig.gt(0)) {
        const cuotaEspecial =
          cuotaApagar > 0 ? cuotaApagar : mesesTranscurridos;
        // Llamamos a tu método centralizado
        const pagoEspecial = await insertarPago({
          numero_credito_sifco: credito.numero_credito_sifco,
          numero_cuota: cuotaEspecial, // No es una cuota normal
          mora: moraBig.toNumber(),

          otros: otrosBig.toNumber(),
          boleta: montoBoleta.toNumber(),
          urlBoletas: urlCompletas ?? [], // URL de la boleta
          pagado: true,

          // Puedes agregar más params si tu método los necesita
        });

        // Actualizar la mora del crédito SOLO si se pagó mora
        if (moraBig.gt(0)) {
          await updateMora({
            credito_id,
            monto_cambio: moraBig.toNumber(),
            tipo: "DECREMENTO", // 👈 porque devolvés la mora al crédito
            activa: true, // 👈 asegurás que quede activa
          });
        }
        pagosRealizados.push(pagoEspecial);
      }
      // o dejar que siga el flujo para saldo a favor si así lo prefieres.
    } else {
      for (const cuota of cuotasPendientes) {
        console.log("CUOTA", cuota);
        const montoCuota = new Big(credito.cuota);
        console.log("disponible", disponible.toString());
        if (disponible.gte(montoCuota)) {
          let abono_capital = new Big(0);
          let abono_interes = new Big(0);
          let abono_iva_12 = new Big(0);
          let abono_interes_ci = new Big(0);
          let abono_iva_ci = new Big(0);
          let abono_seguro = new Big(0);
          let abono_gps = new Big(0);

          let total_monto_cash_in = new Big(0);
          let total_iva_cash_in = new Big(0);
          let total_monto_inversionista = new Big(0);
          let total_iva_inversionista = new Big(0);
          console.log("🚀 Procesando pago para la cuota:", cuota.numero_cuota);
          inversionistasCredito.forEach(
            ({
              monto_cash_in,
              iva_cash_in,
              monto_inversionista,
              iva_inversionista,
            }) => {
              total_monto_cash_in = total_monto_cash_in.plus(monto_cash_in);
              total_iva_cash_in = total_iva_cash_in.plus(iva_cash_in);
              total_monto_inversionista =
                total_monto_inversionista.plus(monto_inversionista);
              total_iva_inversionista =
                total_iva_inversionista.plus(iva_inversionista);
            }
          );
          abono_interes = total_monto_inversionista.plus(total_monto_cash_in);
          abono_iva_12 = abono_iva_12.plus(credito.iva_12);
          abono_seguro = new Big(credito.seguro_10_cuotas);
          abono_gps = new Big(credito.gps);
          abono_interes_ci = new Big(total_monto_cash_in);
          abono_iva_ci = new Big(total_iva_cash_in);
          abono_capital = montoCuota
            .minus(abono_interes)
            .minus(abono_iva_12)
            .minus(abono_seguro)
            .minus(abono_gps)
            .minus(credito.membresias ?? 0);

          const pago_del_mes = await getPagosDelMesActual(credito.credito_id);
          const pago_del_mesBig = new Big(pago_del_mes ?? 0).add(
            montoBoleta ?? 0
          );
          const [existingPago] = await db
            .select({ pago: pagos_credito }) // o los campos que necesites
            .from(pagos_credito)
            .innerJoin(
              cuotas_credito,
              eq(pagos_credito.cuota_id, cuotas_credito.cuota_id)
            )
            .where(
              and(
                eq(cuotas_credito.numero_cuota, cuota.numero_cuota),
                eq(pagos_credito.pagado, false),
                eq(pagos_credito.credito_id, credito.credito_id)
              )
            )
            .limit(1);

          const capital_restante = new Big(credito.capital ?? 0)
            .minus(abono_capital)
            .toString();
          const pagoData = {
            credito_id,
            cuota: montoCuota.toString(),

            cuota_interes: credito.cuota_interes.toString(),
            abono_capital: abono_capital.toString(),
            abono_interes: abono_interes.toString(),
            abono_iva_12: abono_iva_12.toString(),
            abono_interes_ci: abono_interes_ci.toString(),
            abono_iva_ci: abono_iva_ci.toString(),
            abono_seguro: abono_seguro.toString(),
            abono_gps: abono_gps.toString(),
            pago_del_mes: pago_del_mesBig.toString(),
            monto_boleta: montoBoleta.toString(),
            capital_restante: capital_restante.toString(),
            interes_restante: "0",
            iva_12_restante: "0",
            seguro_restante: "0",
            gps_restante: "0",
            total_restante: "0",
            numero_cuota: cuota.numero_cuota,
            llamada: llamada ?? "",
            fecha_pago,
            fecha_filtro: fecha_pago,
            renuevo_o_nuevo: renuevo_o_nuevo ?? "Renuevo",
            tipoCredito: "Renuevo",
            membresias: credito.membresias ?? 0,
            membresias_pago: credito.membresias_pago?.toString() ?? "",
            membresias_mes: credito.membresias?.toString() ?? "",
            otros: otros?.toString() ?? "",
            mora: moraBig.toString(),
            monto_boleta_cuota: montoBoleta.toString(),
            seguro_total: credito.seguro_10_cuotas?.toString() ?? "0",
            pagado: true,
            facturacion: "si",
            mes_pagado,
            seguro_facturado: credito.seguro_10_cuotas?.toString() ?? "0",
            gps_facturado: credito.gps?.toString() ?? "0",
            reserva: "0",
            observaciones: observaciones ?? "",
          };
          type PagoCredito = typeof pagos_credito.$inferSelect;
          let pagoInsertado: PagoCredito | undefined;
          if (existingPago) {
            [pagoInsertado] = await db
              .update(pagos_credito)
              .set(pagoData)
              .from(cuotas_credito) // aquí solo pones la tabla que usas para join
              .where(
                and(
                  eq(cuotas_credito.numero_cuota, cuota.numero_cuota),
                  eq(pagos_credito.pago_id, existingPago.pago.pago_id),
                  eq(pagos_credito.cuota_id, cuotas_credito.cuota_id) // join
                )
              )
              .returning();
            console.log("cuota_id:", cuota);
            console.log("pagoInsertado:", pagoInsertado);
            if (
              pagoInsertado &&
              pagoInsertado.pago_id &&
              urlCompletas.length > 0
            ) {
              await db
                .update(cuotas_credito)
                .set({ pagado: true })
                .where(eq(cuotas_credito.numero_cuota, cuota.numero_cuota));
              await db.insert(boletas).values(
                urlCompletas.map((url) => ({
                  pago_id: pagoInsertado?.pago_id!, // el ! indica que nunca es undefined aquí
                  url_boleta: url,
                }))
              );
            }

            await updateMora({
              credito_id,
              monto_cambio: moraBig.toNumber(),
              tipo: "DECREMENTO", // 👈 porque devolvés la mora al crédito
              activa: true, // 👈 asegurás que quede activa
            });
            const cuota_interes = new Big(capital_restante)
              .times(new Big(credito.porcentaje_interes).div(100))
              .round(2);
            const iva_12 = cuota_interes.times(0.12).round(2);
            console.log("💰 Actualizando pago existente:", capital_restante);
            const deudatotal = new Big(capital_restante)
              .plus(cuota_interes)
              .plus(iva_12)
              .plus(credito.seguro_10_cuotas ?? 0)
              .plus(credito.gps ?? 0)
              .plus(credito.membresias_pago ?? 0)

              .round(2)
              .toString();

            await db
              .update(creditos)
              .set({
                capital: capital_restante.toString(),
                deudatotal: deudatotal,
                iva_12: iva_12.toString(),
                cuota_interes: cuota_interes.toString(),
              })
              .where(eq(creditos.credito_id, credito_id));
            if (!pagoInsertado.paymentFalse) {
              await insertPagosCreditoInversionistas(
                pagoInsertado.pago_id,
                credito_id
              );
            }
          } else {
            console.log("no se encontró un pago existente");
            return { message: "no se encontró un pago existente" };
          }

          pagosRealizados.push(pagoInsertado);

          disponible = disponible.minus(montoCuota);
          await db
            .update(usuarios)
            .set({ saldo_a_favor: disponible.toString() })
            .where(eq(usuarios.usuario_id, usuario_id));
        } else {
          console.log(
            `⛔ No hay suficiente saldo disponible para pagar la cuota ${cuota.numero_cuota}.`
          );
          const midlePayment = insertarPago({
            numero_credito_sifco: credito.numero_credito_sifco,
            numero_cuota: cuota.numero_cuota,
            otros: otrosBig.toNumber(),
            mora: moraBig.toNumber(),
            boleta: montoBoleta.toNumber(),
            urlBoletas: urlCompletas ?? "",
            pagado: false,
          });
          pagosRealizados.push(midlePayment);
          await db
            .update(usuarios)
            .set({ saldo_a_favor: disponible.toString() })
            .where(eq(usuarios.usuario_id, usuario_id));
          return {
            message:
              `No se pudo pagar la cuota ${cuota.numero_cuota} por saldo insuficiente. ` +
              `El monto ingresado fue abonado a su saldo disponible.`,
            pagos: pagosRealizados,
            saldo_a_favor: disponible.toString(),
          };
        }
      }
    }

    const abonoCapital = new Big(abono_directo_capital ?? 0);
    console.log(`💰 Abono directo a capital: Q${abonoCapital.toString()}`);
    if (cuotasPendientes.length === 0 && abonoCapital.gt(0)) {
      const nuevoCapital = new Big(credito.capital).minus(abonoCapital);
      const deudatotal = new Big(nuevoCapital)
        .plus(credito.cuota_interes)
        .plus(credito.iva_12)
        .plus(credito.seguro_10_cuotas ?? 0)
        .plus(credito.gps ?? 0)
        .plus(credito.membresias_pago ?? 0);
      // 🔥 Actualizar capital del crédito

      const cuota_interes = new Big(nuevoCapital)
        .times(new Big(credito.porcentaje_interes).div(100))
        .round(2);
      const iva_12 = cuota_interes.times(0.12).round(2);
      await db
        .update(creditos)
        .set({
          capital: nuevoCapital.toString(),
          deudatotal: deudatotal.toString(),
          cuota_interes: cuota_interes.toString(),
          iva_12: iva_12.toString(),
        })
        .where(eq(creditos.credito_id, credito_id));

      // 🔥 Limpiar saldo a favor del usuario
      await db
        .update(usuarios)
        .set({ saldo_a_favor: "0" })
        .where(eq(usuarios.usuario_id, usuario_id));

      // 🔥 Buscar la cuota que corresponde al mes actual
      const cuotaDelMes = await db
        .select()
        .from(cuotas_credito)
        .where(
          and(
            eq(cuotas_credito.credito_id, credito_id),
            eq(cuotas_credito.numero_cuota, cuotaApagar)
          )
        )
        .limit(1);

      const [pagoExistente] = await db
        .select()
        .from(pagos_credito)
        .where(
          and(
            eq(pagos_credito.credito_id, credito_id),
            eq(pagos_credito.cuota_id, cuotaDelMes[0].cuota_id)
          )
        )
        .limit(1);

      const monthPayments = await getPagosDelMesActual(credito.credito_id);
      const monthPaymentsBig = new Big(monthPayments ?? 0).add(
        monto_boleta ?? 0
      );
      if (cuotaDelMes.length > 0) {
        const cuota = pagoExistente;

        const pagoData = {
          credito_id,
          cuota: cuota.cuota.toString(),
          cuota_interes: credito.cuota_interes.toString(),
          abono_capital: abonoCapital.toString(), // 👉 Todo se va a capital
          abono_interes: "0",
          abono_iva_12: "0",
          abono_interes_ci: "0",
          abono_iva_ci: "0",
          abono_seguro: "0",
          abono_gps: "0",

          pago_del_mes: monthPaymentsBig.toString(),
          monto_boleta: abonoCapital.toString(),
          capital_restante: new Big(cuota.capital_restante ?? 0)
            .minus(abonoCapital)
            .toString(),
          interes_restante: "0",
          iva_12_restante: "0",
          seguro_restante: "0",
          gps_restante: "0",
          total_restante: "0",
          cuota_id: cuota.cuota_id,
          llamada: llamada ?? "",
          fecha_pago,
          fecha_filtro: fecha_pago,
          renuevo_o_nuevo: renuevo_o_nuevo ?? "Renuevo",
          tipoCredito: "Renuevo",
          membresias: credito.membresias ?? 0,
          membresias_pago: credito.membresias_pago?.toString() ?? "",
          membresias_mes: credito.membresias?.toString() ?? "",
          otros: otros?.toString() ?? "",
          mora: moraBig.toString(),
          monto_boleta_cuota: abonoCapital.toString(),
          seguro_total: "0",
          pagado: true,
          facturacion: "si",
          mes_pagado,
          seguro_facturado: "0",
          gps_facturado: "0",
          reserva: "0",
          observaciones: observaciones ?? "",
        };
        console.log("es un abono a capital directo");
        // 🔥 Registrar el pago
        const [pagoInsertado] = await db
          .insert(pagos_credito)
          .values(pagoData)
          .returning();
        if (urlCompletas && urlCompletas.length > 0) {
          await db.insert(boletas).values(
            urlCompletas.map((url) => ({
              pago_id: pagoInsertado?.pago_id,
              url_boleta: url,
            }))
          );
        }
        console.log("PAGO", pagoInsertado);
        await insertPagosCreditoInversionistasSpecial(
          pagoInsertado.pago_id,
          credito_id
        );

        pagosRealizados.push(pagoInsertado);

        console.log(
          `✅ Se abonaron ${montoBoleta.toString()} directamente a capital del crédito ${credito_id} y quedó registrado como pago en la cuota ${
            cuotaDelMes[0].numero_cuota
          }`
        );
        return {
          message: `✅ Se abonaron ${montoBoleta.toString()} directamente a capital del crédito ${credito_id} y quedó registrado como pago en la cuota ${
            cuotaDelMes[0].numero_cuota
          }`,
          pagos: pagosRealizados,
          saldo_a_favor: disponible.toString(),
        };
      } else {
        console.log(
          `⚠️ No se encontró la cuota del mes actual para registrar el pago.`
        );
      }
    } else {
      console.log(
        `⛔ No se puede abonar a capital porque aún hay cuotas pendientes.`
      );
    }

    set.status = 201;
    let message = "";
    if (pagosRealizados.length > 0) {
      cuotasPendientes = [];
    }
    if (cuotasPendientes && cuotasPendientes.length > 0) {
      console.log("tienes cuotas pendientes");
      message = `Aún tienes ${cuotasPendientes.length} cuotas pendientes de pago.  debe cancelar las cuotas de su crédito para abonar a capital o cancelar la mora y otros cargos.`;
    } else if (pagosRealizados.length > 0) {
      message = "Pago registrado exitosamente";
    } else {
      message = "Amount added to balance";
    }

    return {
      message,
      pagos: pagosRealizados,
      saldo_a_favor: disponible.toString(),
    };
  } catch (error) {
    console.error("[insertPayment] Error:", error);
    set.status = 500;
    return {
      message: "Internal server error",
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export async function getAllPagosWithCreditAndInversionistas(
  credito_sifco: string
) {
  try {
    // 1. Traer todos los pagos del crédito, junto a los datos de usuario y crédito
    const pagos = await db
      .select({
        pago_id: pagos_credito.pago_id,
        credito_id: pagos_credito.credito_id,
        cuota_id: pagos_credito.cuota_id,
        numero_cuota: cuotas_credito.numero_cuota,
        cuota: pagos_credito.cuota,
        cuota_interes: pagos_credito.cuota_interes,
        abono_capital: pagos_credito.abono_capital,
        abono_interes: pagos_credito.abono_interes,
        abono_iva_12: pagos_credito.abono_iva_12,
        abono_interes_ci: pagos_credito.abono_interes_ci,
        abono_iva_ci: pagos_credito.abono_iva_ci,
        abono_seguro: pagos_credito.abono_seguro,
        abono_gps: pagos_credito.abono_gps,
        pago_del_mes: pagos_credito.pago_del_mes,
        monto_boleta: pagos_credito.monto_boleta,
        capital_restante: pagos_credito.capital_restante,
        interes_restante: pagos_credito.interes_restante,
        iva_12_restante: pagos_credito.iva_12_restante,
        seguro_restante: pagos_credito.seguro_restante,
        gps_restante: pagos_credito.gps_restante,
        total_restante: pagos_credito.total_restante,
        llamada: pagos_credito.llamada,
        fecha_pago: pagos_credito.fecha_pago,
        fecha_filtro: pagos_credito.fecha_filtro,
        renuevo_o_nuevo: pagos_credito.renuevo_o_nuevo,
        membresias: pagos_credito.membresias,
        membresias_pago: pagos_credito.membresias_pago,
        membresias_mes: pagos_credito.membresias_mes,
        otros: pagos_credito.otros,
        mora: pagos_credito.mora,
        monto_boleta_cuota: pagos_credito.monto_boleta_cuota,
        seguro_total: pagos_credito.seguro_total,
        pagado: pagos_credito.pagado,
        facturacion: pagos_credito.facturacion,
        mes_pagado: pagos_credito.mes_pagado,
        seguro_facturado: pagos_credito.seguro_facturado,
        gps_facturado: pagos_credito.gps_facturado,
        reserva: pagos_credito.reserva,
        observaciones: pagos_credito.observaciones,
        usuario_id: creditos.usuario_id,
        numero_credito_sifco: creditos.numero_credito_sifco,
        usuario_nombre: usuarios.nombre,
        usuario_categoria: usuarios.categoria,
        usuario_nit: usuarios.nit,

        paymentFalse: pagos_credito.paymentFalse,
      })
      .from(pagos_credito)
      .innerJoin(creditos, eq(pagos_credito.credito_id, creditos.credito_id))
      .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .innerJoin(
        cuotas_credito,
        eq(pagos_credito.cuota_id, cuotas_credito.cuota_id)
      )
      .where(eq(creditos.numero_credito_sifco, credito_sifco))
      .orderBy(pagos_credito.fecha_pago);

    const pagoIds = pagos.map((p) => p.pago_id);

    const boletasArr =
      pagoIds.length > 0
        ? await db
            .select({
              pago_id: boletas.pago_id,
              url_boleta: boletas.url_boleta,
            })
            .from(boletas)
            .where(inArray(boletas.pago_id, pagoIds))
        : [];

    console.log("boletasArr", boletasArr);
    // @ts-ignore
    pagos.forEach((p) => {
      const pagoId = Number(p.pago_id);
      // @ts-ignore
      p.boletas = boletasArr
        .filter((b) => Number(b.pago_id) === pagoId)
        .map((b) => b.url_boleta);
    });

    // 2. Traer inversionistas de TODO el crédito solo UNA vez
    const creditosIds = [...new Set(pagos.map((p) => p.credito_id))].filter(
      (id): id is number => id !== null && id !== undefined
    );
    const inversionistasBase = await db.query.creditos_inversionistas.findMany({
      where: (ci, { inArray }) => inArray(ci.credito_id, creditosIds),
    });

    // 3. Traer la info de los inversionistas (nombre y emite_factura) de todos los inversionistas relacionados
    const inversionistaIds = [
      ...new Set(inversionistasBase.map((i) => i.inversionista_id)),
    ];
    const inversionistaInfoArr =
      inversionistaIds.length > 0
        ? await db
            .select({
              inversionista_id: inversionistas.inversionista_id,
              nombre: inversionistas.nombre,
              emite_factura: inversionistas.emite_factura,
            })
            .from(inversionistas)
            .where(
              inversionistaIds.length > 0
                ? inArray(inversionistas.inversionista_id, inversionistaIds)
                : undefined
            )
        : [];

    const inversionistaInfo = Object.fromEntries(
      inversionistaInfoArr.map((i) => [i.inversionista_id, i])
    );

    // 4. Traer TODOS los pagos_inversionistas de TODOS los pagos de una vez

    const pagosInversionistasBase =
      pagoIds.length > 0
        ? await db.query.pagos_credito_inversionistas.findMany({
            where: (pci, { inArray }) => inArray(pci.pago_id, pagoIds),
          })
        : [];

    // 5. Mapear por cada pago
    const result = pagos.map((pago) => {
      // Todos los inversionistas del crédito (siempre array, aunque esté vacío)
      const inversionistasData = inversionistasBase
        .filter((inv) => inv.credito_id === pago.credito_id)
        .map((inv) => ({
          ...inv,
          nombre: inversionistaInfo[inv.inversionista_id]?.nombre ?? "",
          emite_factura:
            inversionistaInfo[inv.inversionista_id]?.emite_factura ?? false,
        }));

      // Todos los pagos a inversionistas de este pago (puede estar vacío)
      const pagosInversionistas = pagosInversionistasBase
        .filter((pi) => pi.pago_id === pago.pago_id)
        .map((pi) => ({
          ...pi,
          nombre: inversionistaInfo[pi.inversionista_id]?.nombre ?? "",
          emite_factura:
            inversionistaInfo[pi.inversionista_id]?.emite_factura ?? false,
        }));

      return {
        pago,
        inversionistasData, // SIEMPRE array (puede ser vacío)
        pagosInversionistas, // SIEMPRE array (puede ser vacío)
      };
    });

    return result;
  } catch (error) {
    console.error("[getAllPagosWithCreditAndInversionistas] Error:", error);
    throw new Error("Error fetching all payments and investor details.");
  }
}

export async function getPayments(
  mes: number,
  anio: number,
  page: number = 1,
  perPage: number = 10,
  numero_credito_sifco: string
) {
  const offset = (page - 1) * perPage;

  // 1. Trae los pagos principales con info básica
  const rows = await db
    .select({
      pago: pagos_credito, // todas las columnas de pagos_credito
      numero_credito_sifco: creditos.numero_credito_sifco, // solo este campo de creditos
    })
    .from(pagos_credito)
    .innerJoin(creditos, eq(pagos_credito.credito_id, creditos.credito_id))
    .where(
      and(
        sql`EXTRACT(MONTH FROM ${pagos_credito.fecha_pago}) = ${mes}`,
        sql`EXTRACT(YEAR FROM ${pagos_credito.fecha_pago}) = ${anio}`,
        numero_credito_sifco !== ""
          ? eq(creditos.numero_credito_sifco, numero_credito_sifco)
          : sql`true`,
        eq(pagos_credito.pagado, true)
      )
    )
    .limit(perPage)
    .offset(offset)
    .orderBy(desc(pagos_credito.fecha_pago));

  // 2. Obtiene los ids de pago para traer los inversionistas de un solo golpe
  const pagoIds = rows.map((row) => row.pago.pago_id);
  let boletasArr: { pago_id: number; url_boleta: string }[] = [];
  if (pagoIds.length > 0) {
    boletasArr = await db
      .select({
        pago_id: boletas.pago_id,
        url_boleta: boletas.url_boleta,
      })
      .from(boletas)
      .where(inArray(boletas.pago_id, pagoIds));
  }
  const boletasPorPago: Record<number, string[]> = {};
  for (const b of boletasArr) {
    if (!boletasPorPago[b.pago_id]) boletasPorPago[b.pago_id] = [];
    boletasPorPago[b.pago_id].push(b.url_boleta);
  }
  // 3. Trae todos los pagos_credito_inversionistas de los pagos actuales
  let pagosInversionistas: any[] = [];
  if (pagoIds.length > 0) {
    pagosInversionistas = await db
      .select()
      .from(pagos_credito_inversionistas)
      .where(inArray(pagos_credito_inversionistas.pago_id, pagoIds));
  }

  // 4. Agrupa inversionistas por pago_id para unirlos luego
  const inversionistasPorPago: Record<number, any[]> = {};
  for (const inv of pagosInversionistas) {
    if (!inversionistasPorPago[inv.pago_id]) {
      inversionistasPorPago[inv.pago_id] = [];
    }
    inversionistasPorPago[inv.pago_id].push(inv);
  }

  // 5. Une todo en el resultado final
  const data = rows.map((row) => ({
    ...row.pago,
    numero_credito_sifco: row.numero_credito_sifco,
    inversionistas: inversionistasPorPago[row.pago.pago_id] || [],
    boletas: boletasPorPago[row.pago.pago_id] || [],
  }));

  // Total de filas
  const [{ count }] = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(pagos_credito)
    .innerJoin(creditos, eq(pagos_credito.credito_id, creditos.credito_id))
    .where(
      and(
        sql`EXTRACT(MONTH FROM ${pagos_credito.fecha_pago}) = ${mes}`,
        sql`EXTRACT(YEAR FROM ${pagos_credito.fecha_pago}) = ${anio}`,
        numero_credito_sifco !== ""
          ? eq(creditos.numero_credito_sifco, numero_credito_sifco)
          : sql`true`,
        eq(pagos_credito.pagado, true)
      )
    );
  return {
    data, // [{ pago, numero_credito_sifco, inversionistas: [...] }]
    page,
    perPage,
    totalCount: Number(count),
    totalPages: Math.ceil(Number(count) / perPage),
  };
}
/**
 * Inserta los registros en pagos_credito_inversionistas para cada inversionista,
 * repartiendo los abonos según el porcentaje de participación (Big.js).
 */
export async function insertPagosCreditoInversionistas(
  pago_id: number,
  credito_id: number,
  excludeCube: boolean = false
) {
  console.log(
    `Insertando pagos_credito_inversionistas para pago_id: ${pago_id}, credito_id: ${credito_id}`
  );
  // 1. Buscar inversionistas del crédito
  const inversionistasData = await db.query.creditos_inversionistas.findMany({
    where: (ci, { eq }) => eq(ci.credito_id, credito_id),
  });

  if (!inversionistasData.length) {
    throw new Error("No hay inversionistas registrados para este crédito");
  }
  const currentPago = await db.query.pagos_credito.findFirst({
    where: (p, { eq }) => eq(p.pago_id, pago_id),
  });
  const currentCredit = await db.query.creditos.findFirst({
    where: (c, { eq }) => eq(c.credito_id, credito_id),
  });
  const inversionistasWithName = await Promise.all(
    inversionistasData.map(async (inv) => {
      const [invRow] = await db
        .select({ nombre: inversionistas.nombre })
        .from(inversionistas)
        .where(eq(inversionistas.inversionista_id, inv.inversionista_id));
      return {
        ...inv,
        nombre: invRow?.nombre ?? "",
      };
    })
  );
  if (!inversionistasWithName.length) {
    throw new Error("No se encontraron inversionistas ");
  }
  const filteredInversionistas = excludeCube
    ? inversionistasWithName.filter(
        (inv) =>
          inv.nombre.trim().toLowerCase() !==
          "cube investments s.a.".toLowerCase()
      )
    : inversionistasWithName;

  console.log(filteredInversionistas);

  const indexMayorCuota = filteredInversionistas.reduce(
    (maxIdx, inv, idx, arr) =>
      new Big(inv.cuota_inversionista ?? 0).gt(
        new Big(arr[maxIdx].cuota_inversionista ?? 0)
      )
        ? idx
        : maxIdx,
    0
  );
  console.log(
    `Mayor cuota encontrada en el índice: ${indexMayorCuota}, valor: ${inversionistasWithName[indexMayorCuota].cuota_inversionista}`
  );
  // 3. Calcular e insertar el abono proporcional de cada inversionista
  const inserts = filteredInversionistas.map(async (inv, idx) => {
    const isCube =
      inv.nombre.trim().toLowerCase() === "cube investments s.a.".toLowerCase();

    const bigInteres = isCube
      ? new Big(inv.monto_cash_in ?? 0)
      : new Big(inv.monto_inversionista);

    const bigIVA = isCube
      ? new Big(inv.iva_cash_in ?? 0)
      : new Big(inv.iva_inversionista);
    console.log("cuotaInversionista", inv.cuota_inversionista);
    let abono_capital = isCube
      ? new Big(inv?.cuota_inversionista ?? 0)
      : new Big(inv.cuota_inversionista ?? 0);
    const totalMontos = new Big(inv.monto_cash_in ?? 0).plus(
      new Big(inv.monto_inversionista ?? 0)
    );
    const totalIVA = new Big(inv.iva_cash_in ?? 0).plus(
      new Big(inv.iva_inversionista ?? 0)
    );

    if (idx === indexMayorCuota && !excludeCube) {
      console.log(
        `Abono al mayor inversionista (${inv.nombre}) con cuota ${inv.cuota_inversionista}`
      );
      // Si es el mayor inversionista, le resta TODO menos los cargos adicionales
      // Al mayor, le restas TODO

      abono_capital = abono_capital
        .minus(totalIVA)
        .minus(totalMontos)
        .minus(new Big(currentCredit?.membresias_pago ?? 0))
        .minus(new Big(currentCredit?.gps ?? 0))
        .minus(new Big(currentCredit?.seguro_10_cuotas ?? 0));
    } else {
      // Al resto, solo interes e iva
      abono_capital = abono_capital.minus(totalIVA).minus(totalMontos);
    }
    console.log("abono_capital", abono_capital.toString());
    await processAndReplaceCreditInvestors(
      credito_id,
      abono_capital.toNumber(),
      false,
      inv.inversionista_id
    );
    console.log("PORCENTAJE CASHIN", inv.porcentaje_cash_in);
    console.log(
      "PORCENTAJE INVERSOR",
      inv.porcentaje_participacion_inversionista
    );
    return {
      pago_id,
      inversionista_id: inv.inversionista_id,
      credito_id,
      abono_capital: abono_capital.toString(),
      abono_interes: bigInteres.toString(),
      abono_iva_12: bigIVA.toString(),
      porcentaje_participacion: isCube
        ? inv.porcentaje_cash_in
        : inv.porcentaje_participacion_inversionista,
      cuota: currentPago?.cuota ?? "0",
      estado_liquidacion: "NO_LIQUIDADO" as const,
    };
  });

  // 4. Insertar todos los registros
  const resolvedInserts = await Promise.all(inserts);
  await db.insert(pagos_credito_inversionistas).values(resolvedInserts);

  return resolvedInserts;
}

/**
 * Updates the estado_liquidacion to "LIQUIDADO" for all payments matching the criteria.
 *
 * @param pago_id - The payment ID
 * @param credito_id - The credit ID
 * @param cuota - (Optional) The cuota value to further filter the records
 * @returns The number of records updated
 */
export async function liquidatePagosCreditoInversionistas(
  pago_id: number,
  credito_id: number,
  cuota: string | number
) {
  console.log(
    `Liquidating payments for pago_id: ${pago_id}, credito_id: ${credito_id}, cuota: ${cuota}`
  );

  // Update the estado_liquidacion to "LIQUIDADO"
  const result = await db
    .update(pagos_credito_inversionistas)
    .set({
      estado_liquidacion: "LIQUIDADO",
    })
    .where(
      and(
        eq(pagos_credito_inversionistas.pago_id, pago_id),
        eq(pagos_credito_inversionistas.credito_id, credito_id),
        eq(pagos_credito_inversionistas.cuota, cuota.toString())
      )
    );

  // 🚨 Si no se actualizó ningún registro, lanza error controlado
  if (!result.rowCount || result.rowCount === 0) {
    throw new Error("No payment found to liquidate with the given criteria");
  }

  return {
    message: "Payments liquidated successfully",
    updatedCount: result.rowCount ?? 0,
  };
}

/**
 * Updates the estado_liquidacion to "LIQUIDADO" for all payments matching the criteria.
 *
 * @param pago_id - The payment ID
 * @param credito_id - The credit ID
 * @param cuota - (Optional) The cuota value to further filter the records
 * @returns The number of records updated
 */
export async function liquidateByInvestor(
  pago_id: number,
  credito_id: number,
  cuota: string | number
) {
  console.log(
    `Liquidating payments for pago_id: ${pago_id}, credito_id: ${credito_id}, cuota: ${cuota}`
  );

  // Update the estado_liquidacion to "LIQUIDADO"
  const result = await db
    .update(pagos_credito_inversionistas)
    .set({
      estado_liquidacion: "LIQUIDADO",
    })
    .where(
      and(
        eq(pagos_credito_inversionistas.pago_id, pago_id),
        eq(pagos_credito_inversionistas.credito_id, credito_id),
        eq(pagos_credito_inversionistas.cuota, cuota.toString())
      )
    );

  // 🚨 Si no se actualizó ningún registro, lanza error controlado
  if (!result.rowCount || result.rowCount === 0) {
    throw new Error("No payment found to liquidate with the given criteria");
  }

  return {
    message: "Payments liquidated successfully",
    updatedCount: result.rowCount ?? 0,
  };
}

// Interfaz para los parámetros
interface InsertarPagoParams {
  numero_credito_sifco: string;
  numero_cuota: number; // opcional si no se especifica
  mora: number;
  otros: number;
  boleta: number;
  urlBoletas: string[]; // opcional si no se especifica
  pagado: boolean;

  // Puedes agregar otros si los necesitas
}

export async function insertarPago({
  numero_credito_sifco,
  numero_cuota,
  mora,
  otros,
  boleta,
  urlBoletas = [],
  pagado = true,
}: InsertarPagoParams) {
  console.log(
    `Insertando pago para crédito SIFCO: ${numero_credito_sifco}, cuota: ${numero_cuota}, mora: ${mora}, otros: ${otros}`
  );
  const [credito] = await db
    .select()
    .from(creditos)
    .where(eq(creditos.numero_credito_sifco, numero_credito_sifco))
    .limit(1);

  if (!credito) {
    throw new Error("No existe el crédito con ese número SIFCO.");
  }
  const [cuotaDelMes] = await db
    .select()
    .from(cuotas_credito)
    .where(
      and(
        eq(cuotas_credito.credito_id, credito.credito_id),
        eq(cuotas_credito.numero_cuota, numero_cuota)
      )
    )
    .limit(1);
  // 1. Buscar el crédito y la data actual
  const pagos = await db
    .select({
      pago_id: pagos_credito.pago_id,
      credito_id: pagos_credito.credito_id,
      cuota_id: pagos_credito.cuota_id,
      cuota: pagos_credito.cuota,
      numero_cuota: cuotas_credito.numero_cuota,
      cuota_interes: pagos_credito.cuota_interes,
      abono_capital: pagos_credito.abono_capital,
      abono_interes: pagos_credito.abono_interes,
      abono_iva_12: pagos_credito.abono_iva_12,
      abono_interes_ci: pagos_credito.abono_interes_ci,
      abono_iva_ci: pagos_credito.abono_iva_ci,
      abono_seguro: pagos_credito.abono_seguro,
      abono_gps: pagos_credito.abono_gps,
      pago_del_mes: pagos_credito.pago_del_mes,
      monto_boleta: pagos_credito.monto_boleta,
      capital_restante: pagos_credito.capital_restante,
      interes_restante: pagos_credito.interes_restante,
      iva_12_restante: pagos_credito.iva_12_restante,
      seguro_restante: pagos_credito.seguro_restante,
      gps_restante: pagos_credito.gps_restante,
      total_restante: pagos_credito.total_restante,
      llamada: pagos_credito.llamada,
      fecha_pago: pagos_credito.fecha_pago,
      fecha_filtro: pagos_credito.fecha_filtro,
      renuevo_o_nuevo: pagos_credito.renuevo_o_nuevo,
      membresias: pagos_credito.membresias,
      membresias_pago: pagos_credito.membresias_pago,
      membresias_mes: pagos_credito.membresias_mes,
      otros: pagos_credito.otros,
      mora: pagos_credito.mora,
      monto_boleta_cuota: pagos_credito.monto_boleta_cuota,
      seguro_total: pagos_credito.seguro_total,
      pagado: pagos_credito.pagado,
      facturacion: pagos_credito.facturacion,
      mes_pagado: pagos_credito.mes_pagado,
      seguro_facturado: pagos_credito.seguro_facturado,
      gps_facturado: pagos_credito.gps_facturado,
      reserva: pagos_credito.reserva,
      observaciones: pagos_credito.observaciones,
      usuario_id: creditos.usuario_id,
      numero_credito_sifco: creditos.numero_credito_sifco,
      usuario_nombre: usuarios.nombre,
      usuario_categoria: usuarios.categoria,
      usuario_nit: usuarios.nit,
      // Agrega más si lo necesitas
      seguro_10_cuotas: creditos.seguro_10_cuotas,
      gps: creditos.gps,
      iva_12: creditos.iva_12,
      deudatotal: creditos.deudatotal,
    })
    .from(pagos_credito)
    .innerJoin(creditos, eq(pagos_credito.credito_id, creditos.credito_id))
    .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
    .leftJoin(
      cuotas_credito,
      eq(pagos_credito.cuota_id, cuotas_credito.cuota_id)
    )
    .where(
      and(
        eq(creditos.numero_credito_sifco, numero_credito_sifco),
        eq(pagos_credito.cuota_id, cuotaDelMes.cuota_id ?? 0)
      )
    )
    .orderBy(pagos_credito.pago_id);

  if (!pagos.length) {
    throw new Error("No existe el crédito con ese número SIFCO.");
  }

  const creditData = pagos[pagos.length - 1];
  if (creditData.credito_id == null) {
    throw new Error("El crédito no tiene un ID válido.");
  }
  const monthPayments = await getPagosDelMesActual(creditData.credito_id);
  const monthPaymentsBig = new Big(monthPayments ?? 0).add(boleta ?? 0);
  const [nuevoPago] = await db
    .insert(pagos_credito)
    .values({
      credito_id: creditData.credito_id,
      cuota_id: creditData.cuota_id ?? 0,
      cuota: creditData.cuota?.toString() ?? "0",
      cuota_interes: creditData.cuota_interes?.toString() ?? "0",

      abono_capital: "0",
      abono_interes: "0",
      abono_iva_12: "0",
      abono_interes_ci: "0",
      abono_iva_ci: "0",
      abono_seguro: "0",
      abono_gps: "0",
      pago_del_mes: monthPaymentsBig.toString() ?? "0",
      monto_boleta: boleta.toString(),

      capital_restante: creditData.capital_restante?.toString() ?? "0",
      interes_restante: creditData.cuota_interes?.toString() ?? "0",
      iva_12_restante: creditData.iva_12?.toString() ?? "0",
      seguro_restante: creditData.seguro_10_cuotas?.toString() ?? "0",
      gps_restante: creditData.gps?.toString() ?? "0",
      total_restante: creditData.deudatotal?.toString() ?? "0",

      llamada: "",

      renuevo_o_nuevo: "renuevo",

      membresias: creditData.membresias_pago ?? "0",
      membresias_pago: creditData.membresias_pago?.toString() ?? "",
      membresias_mes: creditData.membresias_mes?.toString() ?? "",
      otros: otros.toString() ?? "0",
      mora: mora.toString(),
      monto_boleta_cuota: boleta.toString(),
      seguro_total: creditData.seguro_10_cuotas?.toString() ?? "0",
      pagado: pagado,
      facturacion: "si",
      mes_pagado: "",
      seguro_facturado: creditData.seguro_10_cuotas?.toString() ?? "0",
      gps_facturado: creditData.gps?.toString() ?? "0",
      reserva: "0",
      observaciones: "",
    })
    .returning();
  if (mora && Number(mora) > 0) {
    await updateMora({
      credito_id: creditData.credito_id,
      monto_cambio: Number(mora),
      tipo: "DECREMENTO", // 👈 bajamos la mora porque el cliente ya pagó
    });
  }

  if (urlBoletas && urlBoletas.length > 0) {
    await db.insert(boletas).values(
      urlBoletas.map((url) => ({
        pago_id: nuevoPago?.pago_id,
        url_boleta: url,
      }))
    );
  }
  console.log("Nuevo pago insertado:", nuevoPago);

  return nuevoPago;
}

export async function insertPagosCreditoInversionistasSpecial(
  pago_id: number,
  credito_id: number
) {
  console.log(
    `Insertando pagos_credito_inversionistas para pago_id: ${pago_id}, credito_id: ${credito_id}`
  );
  // 1. Buscar inversionistas del crédito
  const inversionistasData = await db.query.creditos_inversionistas.findMany({
    where: (ci, { eq }) => eq(ci.credito_id, credito_id),
  });

  if (!inversionistasData.length) {
    throw new Error("No hay inversionistas registrados para este crédito");
  }
  const currentPago = await db.query.pagos_credito.findFirst({
    where: (p, { eq }) => eq(p.pago_id, pago_id),
  });

  const inversionistasWithName = await Promise.all(
    inversionistasData.map(async (inv) => {
      const [invRow] = await db
        .select({ nombre: inversionistas.nombre }) // Usa el nombre real de tu tabla
        .from(inversionistas)
        .where(eq(inversionistas.inversionista_id, inv.inversionista_id));
      return {
        ...inv,
        nombre: invRow?.nombre ?? "",
      };
    })
  );
  const indexMayorCuota = inversionistasWithName.reduce(
    (maxIdx, inv, idx, arr) =>
      new Big(inv.cuota_inversionista ?? 0).gt(
        new Big(arr[maxIdx].cuota_inversionista ?? 0)
      )
        ? idx
        : maxIdx,
    0
  );
  console.log(
    `Mayor cuota encontrada en el índice: ${indexMayorCuota}, valor: ${inversionistasWithName[indexMayorCuota].cuota_inversionista}`
  );
  const total_porcentaje_cash_in = inversionistasWithName.reduce(
    (sum, inv) => sum + Number(inv.porcentaje_cash_in),
    0
  );
  const total_porcentaje_inversion = inversionistasWithName.reduce(
    (sum, inv) => sum + Number(inv.porcentaje_participacion_inversionista),
    0
  );
  // 3. Calcular e insertar el abono proporcional de cada inversionista
  const inserts = inversionistasWithName.map(async (inv, idx) => {
    const isCube =
      inv.nombre.trim().toLowerCase() === "cube investments s.a.".toLowerCase();

    let abono_universo = new Big(0);
    let porcentaje = new Big(0);

    if (isCube) {
      porcentaje = new Big(inv.porcentaje_cash_in);
      // Usar Big.js en los cálculos
      abono_universo =
        total_porcentaje_cash_in > 0
          ? porcentaje
              .div(total_porcentaje_cash_in)
              .times(inv.porcentaje_cash_in)
          : new Big(0);
    } else {
      porcentaje = new Big(inv.porcentaje_participacion_inversionista);
      abono_universo =
        total_porcentaje_inversion > 0
          ? porcentaje
              .div(total_porcentaje_inversion)
              .times(inv.porcentaje_participacion_inversionista)
          : new Big(0);
    }

    const newAmount = new Big(inv.monto_inversionista ?? 0).minus(
      abono_universo
    );
    await db
      .update(creditos_inversionistas)
      .set({
        monto_aportado: newAmount.toString(),
      })
      .where(and(eq(creditos_inversionistas.credito_id, credito_id)));
    return {
      pago_id,
      inversionista_id: inv.inversionista_id,
      credito_id,
      abono_capital: abono_universo.toString(),
      abono_interes: "0",
      abono_iva_12: "0",
      porcentaje_participacion: isCube
        ? inv.porcentaje_cash_in
        : inv.porcentaje_participacion_inversionista,
      cuota: currentPago?.cuota ?? "0",
      estado_liquidacion: "NO_LIQUIDADO" as const,
    };
  });

  // 4. Insertar todos los registros
  const resolvedInserts = await Promise.all(inserts);
  await db.insert(pagos_credito_inversionistas).values(resolvedInserts);

  return resolvedInserts;
}
export async function falsePayment(pago_id: number, credito_id: number) {
  console.log(
    `Falsificando pago con ID: ${pago_id} para crédito ID: ${credito_id}`
  );
  insertPagosCreditoInversionistas(pago_id, credito_id, true); // Excluir Cube Investments
  // Actualizar el estado del pago a falso
  const result = await db
    .update(pagos_credito)
    .set({
      pagado: false,
      paymentFalse: true,
    })
    .where(
      and(
        eq(pagos_credito.pago_id, pago_id),
        eq(pagos_credito.credito_id, credito_id)
      )
    );

  // 🚨 Si no se actualizó ningún registro, lanza error controlado
  if (!result.rowCount || result.rowCount === 0) {
    throw new Error(
      "No payment found to mark as false with the given criteria"
    );
  }

  return {
    message: "Payment marked as false successfully",
    updatedCount: result.rowCount ?? 0,
  };
}

export async function getPagosDelMesActual(credito_id: number) {
  const hoy = new Date();
  const mes = hoy.getMonth() + 1; // getMonth() es 0-based
  const anio = hoy.getFullYear();

  // Trae todos los pagos válidos de este mes y año
  const pagos = await db
    .select({ monto_boleta: pagos_credito.monto_boleta })
    .from(pagos_credito)
    .where(
      and(
        eq(pagos_credito.pagado, true),
        sql`EXTRACT(MONTH FROM ${pagos_credito.fecha_pago}) = ${mes}`,
        sql`EXTRACT(YEAR FROM ${pagos_credito.fecha_pago}) = ${anio}`,
        eq(pagos_credito.credito_id, credito_id)
      )
    );

  // Suma con Big.js
  let total = Big(0);
  for (const pago of pagos) {
    if (pago.monto_boleta !== null) {
      total = total.plus(pago.monto_boleta);
    }
  }

  return total.toFixed(2); // Devuelve como string, siempre dos decimales
}
 
 
interface GetPagosOptions {
  page?: number;
  pageSize?: number;
  numeroCredito?: string;
  dia?: number;
  mes?: number;
  anio?: number;
  inversionistaId?: number;
}

export async function getPagosConInversionistas(options: GetPagosOptions = {}) {
  const {
    page = 1,
    pageSize = 20,
    numeroCredito,
    dia,
    mes,
    anio,
    inversionistaId,
  } = options;

  try {
    const conditions: any[] = [eq(creditos.statusCredit, "ACTIVO")];

    // ✅ Filtros dinámicos
    if (numeroCredito) {
      conditions.push(eq(creditos.numero_credito_sifco, numeroCredito));
    }
    if (anio) {
      conditions.push(sql.raw(`EXTRACT(YEAR FROM p.fecha_pago) = ${anio}`));
    }
    if (mes) {
      conditions.push(sql.raw(`EXTRACT(MONTH FROM p.fecha_pago) = ${mes}`));
    }
    if (dia) {
      conditions.push(sql.raw(`EXTRACT(DAY FROM p.fecha_pago) = ${dia}`));
    }
    if (inversionistaId) {
      conditions.push(
        eq(inversionistas.inversionista_id, inversionistaId)
      );
    }

    const offset = (page - 1) * pageSize;

    // ✅ Consulta principal (evita duplicados)
    const rows = await db.execute(
      sql`
      SELECT DISTINCT ON (p.pago_id)
        p.pago_id AS "pagoId",
        p.monto_boleta AS "montoBoleta",
        p.numeroAutorizacion AS "numeroAutorizacion",
        p.fecha_pago AS "fechaPago",
        c.credito_id AS "creditoId",
        c.numero_credito_sifco AS "numeroCredito",
        c.capital AS "capital",
        c.deudatotal AS "deudaTotal",
        u.nombre AS "usuarioNombre",
        i.inversionista_id AS "inversionistaId",
        i.nombre AS "nombreInversionista",
        pci.abono_capital AS "abonoCapital",
        pci.abono_interes AS "abonoInteres",
        pci.abono_iva_12 AS "abonoIva",
        pci.cuota AS "cuotaPago",
        p.abono_interes AS "abono_interes",
        p.abono_iva_12 AS "abono_iva_12",
        p.abono_interes_ci AS "abono_interes_ci",
        p.abono_iva_ci AS "abono_iva_ci",
        p.abono_seguro AS "abono_seguro",
        p.abono_gps AS "abono_gps",
        ci.monto_aportado AS "montoAportado",
        ci.porcentaje_participacion_inversionista AS "porcentajeParticipacion",
        b.id AS "boletaId",
        b.url_boleta AS "urlBoleta"
      FROM cartera.pagos_credito p
      LEFT JOIN cartera.creditos c ON c.credito_id = p.credito_id
      LEFT JOIN cartera.usuarios u ON u.usuario_id = c.usuario_id
      LEFT JOIN cartera.pagos_credito_inversionistas pci ON pci.pago_id = p.pago_id
      LEFT JOIN cartera.inversionistas i ON i.inversionista_id = pci.inversionista_id
      LEFT JOIN cartera.creditos_inversionistas ci ON ci.credito_id = c.credito_id
      LEFT JOIN cartera.boletas b ON b.pago_id = p.pago_id
      WHERE ${and(...conditions)}
      ORDER BY p.pago_id DESC
      LIMIT ${pageSize} OFFSET ${offset};
    `
    );

    const pagosMap: Record<number, any> = {};

    for (const row of rows.rows) {
      if (!pagosMap[row.pagoId]) {
        pagosMap[row.pagoId] = {
          pagoId: row.pagoId,
          montoBoleta: row.montoBoleta,
          numeroAutorizacion: row.numeroAutorizacion,
          fechaPago: row.fechaPago,
          creditoId: row.creditoId,
          numeroCredito: row.numeroCredito,
          capital: row.capital,
          deudaTotal: row.deudaTotal,
          usuarioNombre: row.usuarioNombre,
          boleta: row.boletaId
            ? {
                boletaId: row.boletaId,
                urlBoleta: row.urlBoleta,
              }
            : null,
          abono_interes: row.abono_interes,
          abono_iva_12: row.abono_iva_12,
          abono_interes_ci: row.abono_interes_ci,
          abono_iva_ci: row.abono_iva_ci,
          abono_seguro: row.abono_seguro,
          abono_gps: row.abono_gps,
          inversionistas: [],
        };
      }

      // ✅ Si hay inversionistas, agrégalos al grupo
      if (row.inversionistaId) {
        pagosMap[row.pagoId].inversionistas.push({
          inversionistaId: row.inversionistaId,
          nombreInversionista: row.nombreInversionista,
          abonoCapital: row.abonoCapital,
          abonoInteres: row.abonoInteres,
          abonoIva: row.abonoIva,
          isr: row.abonoInteres ? Number(row.abonoInteres) * 0.05 : 0,
          cuotaPago: row.cuotaPago,
          montoAportado: row.montoAportado,
          porcentajeParticipacion: row.porcentajeParticipacion,
        });
      }
    }

    return {
      page,
      pageSize,
      total: rows.rowCount,
      data: Object.values(pagosMap),
    };
  } catch (error: any) {
    console.error("❌ Error en getPagosConInversionistas:", error);
    return {
      page,
      pageSize,
      total: 0,
      data: [],
      error: error.message,
    };
  }
}