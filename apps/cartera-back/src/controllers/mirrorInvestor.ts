import Big from "big.js";
import { db } from "../database";
import {
  creditos,
  creditos_inversionistas,
  creditos_inversionistas_espejo,
} from "../database/db";
import { and, eq } from "drizzle-orm";

/**
 * Controller: llenarTablaEspejo
 *
 * Recibe datos del inversionista con montos nuevos, calcula los campos derivados
 * usando la misma lógica que createCredit, y los inserta/actualiza en la tabla espejo.
 *
 * Campos recibidos: credito_id, inversionista_id, monto (nuevo monto_aportado),
 *   porcentaje_inversion, porcentaje_cash_in, iva_inversionista
 *
 * Campos calculados: monto_inversionista, monto_cash_in, iva_cash_in
 * Campos del padre: cuota_inversionista
 */
export const llenarTablaEspejo = async ({ body, set }: any) => {
  try {
    const {
      credito_id,
      inversionista_id,
      monto,
      porcentaje_inversion,
      porcentaje_cash_in,
      iva_inversionista,
    } = body;

    // 1) Consultar el registro padre en creditos_inversionistas
    const [padre] = await db
      .select()
      .from(creditos_inversionistas)
      .where(
        and(
          eq(creditos_inversionistas.credito_id, credito_id),
          eq(creditos_inversionistas.inversionista_id, inversionista_id)
        )
      )
      .limit(1);

    if (!padre) {
      set.status = 404;
      return {
        success: false,
        message: "No se encontró el registro padre en creditos_inversionistas",
      };
    }

    // 2) Consultar el crédito para obtener porcentaje_interes
    const [creditoData] = await db
      .select()
      .from(creditos)
      .where(eq(creditos.credito_id, credito_id))
      .limit(1);

    if (!creditoData) {
      set.status = 404;
      return {
        success: false,
        message: "No se encontró el crédito",
      };
    }

    // 3) Cálculos con Big.js (misma lógica que createCredit)
    const montoAportado = new Big(monto);
    const porcInversion = new Big(porcentaje_inversion);
    const porcCashIn = new Big(porcentaje_cash_in);
    const interes = new Big(creditoData.porcentaje_interes ?? 0);

    // cuota_interes = monto * (porcentaje_interes / 100)
    const cuotaInteres = montoAportado.times(interes.div(100)).round(2);

    // Distribución del interés
    const montoInversionista = cuotaInteres.times(porcInversion).div(100).round(2);
    const montoCashIn = cuotaInteres.times(porcCashIn).div(100).round(2);

    // IVA cash-in = monto_cash_in * 0.12 (si monto_cash_in > 0)
    const ivaCashIn = Number(montoCashIn) > 0
      ? montoCashIn.times(0.12).round(2)
      : new Big(0);

    // porcentaje_participacion_inversionista se mantiene del padre
    const porcentajeParticipacion = padre.porcentaje_participacion_inversionista;

    // cuota_inversionista viene del padre
    const cuotaInversionista = padre.cuota_inversionista;

    // 4) Verificar si ya existe un registro espejo para este credito+inversionista
    const [existente] = await db
      .select()
      .from(creditos_inversionistas_espejo)
      .where(
        and(
          eq(creditos_inversionistas_espejo.credito_id, credito_id),
          eq(creditos_inversionistas_espejo.inversionista_id, inversionista_id)
        )
      )
      .limit(1);

    const dataEspejo = {
      credito_id,
      inversionista_id,
      cuota_inversionista: cuotaInversionista,
      porcentaje_participacion_inversionista: porcentajeParticipacion,
      monto_aportado: montoAportado.toString(),
      porcentaje_cash_in: porcCashIn.toString(),
      monto_inversionista: montoInversionista.toString(),
      monto_cash_in: montoCashIn.toString(),
      iva_inversionista: new Big(iva_inversionista).toString(),
      iva_cash_in: ivaCashIn.toString(),
      fecha_creacion: new Date(),
    };

    if (existente) {
      // UPDATE
      await db
        .update(creditos_inversionistas_espejo)
        .set(dataEspejo)
        .where(eq(creditos_inversionistas_espejo.id, existente.id));

      set.status = 200;
      return {
        success: true,
        message: "Registro espejo actualizado correctamente",
        data: dataEspejo,
      };
    } else {
      // INSERT
      await db
        .insert(creditos_inversionistas_espejo)
        .values(dataEspejo);

      set.status = 201;
      return {
        success: true,
        message: "Registro espejo creado correctamente",
        data: dataEspejo,
      };
    }
  } catch (error) {
    console.error("[llenarTablaEspejo] Error:", error);
    set.status = 500;
    return {
      success: false,
      message: "Error al llenar tabla espejo",
      error: String(error),
    };
  }
};
