// app.ts (o donde declares tus rutas Elysia)
import { z } from "zod";
import { db } from "../database/index";
import {
  creditos,
  creditos_inversionistas,
  inversionistas,
  pagos_credito,
  pagos_credito_inversionistas,
  usuarios,
} from "../database/db/schema";
import { eq, and, sql, inArray } from "drizzle-orm";
export const insertInvestor = async ({ body, set }: any) => {
  try {
    let inversionistasToInsert = [];

    // Permitir un solo objeto o un arreglo
    if (Array.isArray(body)) {
      inversionistasToInsert = body;
    } else if (typeof body === "object") {
      inversionistasToInsert = [body];
    }

    // Validación: todos deben tener nombre y emite_factura
    const isValid = inversionistasToInsert.every(
      (inv) => inv.nombre && typeof inv.emite_factura !== "undefined"
    );
    if (!isValid || inversionistasToInsert.length === 0) {
      set.status = 400;
      return {
        message: "Todos los inversionistas deben tener nombre y emite_factura.",
      };
    }

    // Puedes incluir 'categoria_pago' si tu modelo lo espera
    const inserted = await db
      .insert(inversionistas)
      .values(
        inversionistasToInsert.map(
          ({ nombre, emite_factura, categoria_pago }) => ({
            nombre,
            emite_factura,
            categoria_pago: categoria_pago ?? null,
          })
        )
      )
      .returning();

    set.status = 201;
    return inserted;
  } catch (error) {
    set.status = 500;
    return { message: "Error inserting investors", error: String(error) };
  }
};

// GET: Obtener inversionistas (uno o todos)
export const getInvestors = async ({ query, set }: any) => {
  try {
    // Si quieres buscar por ID
    if (query.id) {
      const result = await db
        .select()
        .from(inversionistas)
        .where(eq(inversionistas.inversionista_id, query.id));
      set.status = result.length ? 200 : 404;
      return result.length
        ? result[0]
        : { message: "Inversionista no encontrado" };
    }

    // Si quieres buscar por nombre
    if (query.nombre) {
      const result = await db
        .select()
        .from(inversionistas)
        .where(eq(inversionistas.nombre, query.nombre));
      set.status = result.length ? 200 : 404;
      return result.length
        ? result
        : { message: "Inversionista no encontrado" };
    }

    // Si no hay query, trae todos
    const all = await db.select().from(inversionistas);
    set.status = 200;
    return all;
  } catch (error) {
    set.status = 500;
    return {
      message: "Error al consultar inversionistas",
      error: String(error),
    };
  }
};

import Big from "big.js";

export const getInvestorsWithCredits = async () => {
  const data = await db
    .select({
      inversionista_id: inversionistas.inversionista_id,
      nombre: inversionistas.nombre,
      emite_factura: inversionistas.emite_factura,
      credito_id: creditos_inversionistas.credito_id,
      porcentaje_participacion:
        creditos_inversionistas.porcentaje_participacion_inversionista,
      monto_asignado: creditos_inversionistas.monto_inversionista,
      iva: creditos_inversionistas.iva_inversionista,
      numero_credito_sifco: creditos.numero_credito_sifco,
      capital: creditos.capital,
    })
    .from(inversionistas)
    .leftJoin(
      creditos_inversionistas,
      eq(
        inversionistas.inversionista_id,
        creditos_inversionistas.inversionista_id
      )
    )
    .leftJoin(
      creditos,
      eq(creditos_inversionistas.credito_id, creditos.credito_id)
    );

  const resultado = data.reduce((acc: any[], item) => {
    const inversionistaExistente = acc.find(
      (inv) => inv.inversionista_id === item.inversionista_id
    );

    const creditoData = item.credito_id
      ? {
          credito_id: item.credito_id,
          numero_credito_sifco: item.numero_credito_sifco,
          capital: item.capital,
          porcentaje_participacion: item.porcentaje_participacion,
          monto_asignado: item.monto_asignado,
          iva: item.iva,
        }
      : null;

    if (inversionistaExistente) {
      if (creditoData) {
        inversionistaExistente.creditos.push(creditoData);
      }
      inversionistaExistente.total_creditos =
        inversionistaExistente.creditos.length;

      // 🔥 Sumar el monto asignado
      const currentSum = new Big(inversionistaExistente.total_monto_asignado);
      const newSum = creditoData
        ? currentSum.plus(creditoData.monto_asignado ?? 0)
        : currentSum;
      inversionistaExistente.total_monto_asignado = newSum.toString();
    } else {
      acc.push({
        inversionista_id: item.inversionista_id,
        nombre: item.nombre,
        emite_factura: item.emite_factura,
        total_creditos: creditoData ? 1 : 0,
        total_monto_asignado: creditoData
          ? new Big(creditoData.monto_asignado ?? 0).toString()
          : "0",
        creditos: creditoData ? [creditoData] : [],
      });
    }

    return acc;
  }, []);

  return resultado;
};

/**
 * Processes and replaces all investors of a given credit:
 * - Fetches the credit and its current investors
 * - Calculates new values for each investor (using Big.js)
 * - Deletes previous investors
 * - Inserts the updated investor data
 *
 * @param credito_id - The credit ID to process
 * @returns The inserted investors data after processing
 * @throws Error if the credit does not exist
 */

export async function processAndReplaceCreditInvestors(
  credito_id: number,
  abono_capital: number,
  addition: boolean,
  inversionista_id: number
) {
  // 1. Fetch credit details
  const credit = await db.query.creditos.findFirst({
    where: (c, { eq }) => eq(c.credito_id, credito_id),
  });

  if (!credit) {
    throw new Error("Credit not found");
  }

  // 2. Fetch all investors for this credit
  const investors = await db.query.creditos_inversionistas.findMany({
    where: (ci, { eq }) => eq(ci.inversionista_id, inversionista_id),
  });

  if (investors.length === 0) {
    return [];
  }
  console.log("adition", addition);
  // 3. Process and calculate new values for each investor
  const processedInvestors = investors.map((inv) => {
    const montoAportado = addition
      ? new Big(inv.monto_aportado).add(abono_capital)
      : new Big(inv.monto_aportado).minus(abono_capital);
    console.log("montoAportado", montoAportado.toString());
    const porcentajeCashIn = new Big(inv.porcentaje_cash_in);
    const porcentajeInversion = new Big(
      inv.porcentaje_participacion_inversionista
    );
    const cuota = montoAportado
      .times(credit.porcentaje_interes)
      .div(100)
      .round(2);

    // Proportional amounts
    const montoInversionista = cuota
      .times(porcentajeInversion)
      .div(100)
      .round(2);
    const montoCashIn = cuota.times(porcentajeCashIn).div(100).round(2);

    // IVAs
    const ivaInversionista = montoInversionista.gt(0)
      ? montoInversionista.times(0.12).round(2)
      : new Big(0);
    const ivaCashIn = montoCashIn.gt(0)
      ? montoCashIn.times(0.12).round(2)
      : new Big(0);

    return {
      ...inv, // trae el id necesario para el update
      credito_id,
      monto_aportado: montoAportado.toFixed(2),
      porcentaje_cash_in: porcentajeCashIn.toFixed(2),
      porcentaje_participacion_inversionista: porcentajeInversion.toFixed(2),
      monto_inversionista: montoInversionista.toFixed(2),
      monto_cash_in: montoCashIn.toFixed(2),
      iva_inversionista: ivaInversionista.toFixed(2),
      iva_cash_in: ivaCashIn.toFixed(2),
      fecha_creacion: new Date(),
      cuota_inversionista: inv.cuota_inversionista,
    };
  });

  // 4. Update all processed investors by their id
  for (const inv of processedInvestors) {
    await db
      .update(creditos_inversionistas)
      .set({
        cuota_inversionista: inv.cuota_inversionista,
        porcentaje_participacion_inversionista:
          inv.porcentaje_participacion_inversionista,
        monto_aportado: inv.monto_aportado,
        porcentaje_cash_in: inv.porcentaje_cash_in,
        iva_inversionista: inv.iva_inversionista,
        iva_cash_in: inv.iva_cash_in,
        monto_inversionista: inv.monto_inversionista,
        monto_cash_in: inv.monto_cash_in,
        // fecha_creacion: inv.fecha_creacion, // Descomenta si deseas actualizarla
      })
      .where(eq(creditos_inversionistas.id, inv.id));
  }

  // 5. Return the new updated data (could re-fetch if you want actual DB values)
  return processedInvestors;
}
export async function processAndReplaceCreditInvestorsReverse(
  credito_id: number,
  abono_capital: number,
  addition: boolean,
 
) {
  // 1. Fetch credit details
  const credit = await db.query.creditos.findFirst({
    where: (c, { eq }) => eq(c.credito_id, credito_id),
  });

  if (!credit) {
    throw new Error("Credit not found");
  }

  // 2. Fetch all investors for this credit
  const investors = await db.query.creditos_inversionistas.findMany({
    where: (ci, { eq }) => eq(ci.credito_id, credito_id),
  });

  if (investors.length === 0) {
    return [];
  }
  console.log("adition", addition);
  // 3. Process and calculate new values for each investor
  const processedInvestors = investors.map((inv) => {
    const montoAportado = addition
      ? new Big(inv.monto_aportado).add(abono_capital)
      : new Big(inv.monto_aportado).minus(abono_capital);
    console.log("montoAportado", montoAportado.toString());
    const porcentajeCashIn = new Big(inv.porcentaje_cash_in);
    const porcentajeInversion = new Big(
      inv.porcentaje_participacion_inversionista
    );
    const cuota = montoAportado
      .times(credit.porcentaje_interes)
      .div(100)
      .round(2);

    // Proportional amounts
    const montoInversionista = cuota
      .times(porcentajeInversion)
      .div(100)
      .round(2);
    const montoCashIn = cuota.times(porcentajeCashIn).div(100).round(2);

    // IVAs
    const ivaInversionista = montoInversionista.gt(0)
      ? montoInversionista.times(0.12).round(2)
      : new Big(0);
    const ivaCashIn = montoCashIn.gt(0)
      ? montoCashIn.times(0.12).round(2)
      : new Big(0);

    return {
      ...inv, // trae el id necesario para el update
      credito_id,
      monto_aportado: montoAportado.toFixed(2),
      porcentaje_cash_in: porcentajeCashIn.toFixed(2),
      porcentaje_participacion_inversionista: porcentajeInversion.toFixed(2),
      monto_inversionista: montoInversionista.toFixed(2),
      monto_cash_in: montoCashIn.toFixed(2),
      iva_inversionista: ivaInversionista.toFixed(2),
      iva_cash_in: ivaCashIn.toFixed(2),
      fecha_creacion: new Date(),
      cuota_inversionista: inv.cuota_inversionista,
    };
  });

  // 4. Update all processed investors by their id
  for (const inv of processedInvestors) {
    await db
      .update(creditos_inversionistas)
      .set({
        cuota_inversionista: inv.cuota_inversionista,
        porcentaje_participacion_inversionista:
          inv.porcentaje_participacion_inversionista,
        monto_aportado: inv.monto_aportado,
        porcentaje_cash_in: inv.porcentaje_cash_in,
        iva_inversionista: inv.iva_inversionista,
        iva_cash_in: inv.iva_cash_in,
        monto_inversionista: inv.monto_inversionista,
        monto_cash_in: inv.monto_cash_in,
        // fecha_creacion: inv.fecha_creacion, // Descomenta si deseas actualizarla
      })
      .where(eq(creditos_inversionistas.id, inv.id));
  }

  // 5. Return the new updated data (could re-fetch if you want actual DB values)
  return processedInvestors;
}

/**
 * Resumen de pagos NO LIQUIDADOS agrupados por inversionista, incluyendo detalle de créditos,
 * usuario titular, totales, IVA, ISR, % inversor y ajuste de cuota según si factura o no.
 */
/**
 * Resumen de pagos NO LIQUIDADOS agrupados por inversionista y crédito.
 * Devuelve también subtotales por inversionista, totales globales,
 * y cada resumen individual incluye su subtotal global.
 */
export async function resumeInvestor(
  investorId?: number,
  page = 1,
  perPage = 10
) {
  const conditionInvestor = investorId
    ? eq(inversionistas.inversionista_id, investorId)
    : sql`TRUE`;
  const listaInversionistas = await db
    .select({
      inversionista_id: inversionistas.inversionista_id,
      inversionista: inversionistas.nombre,
      emite_factura: inversionistas.emite_factura,
    })
    .from(inversionistas)
    .where(conditionInvestor);

  // PAGINADO de inversionistas
  const pageNum = Math.max(1, Number(page) || 1);
  const perPageNum = Math.max(1, Number(perPage) || 10);
  const totalItems = listaInversionistas.length;
  const totalPages = Math.ceil(totalItems / perPageNum);
  const startIdx = (pageNum - 1) * perPageNum;
  const pagedInversionistas = listaInversionistas.slice(
    startIdx,
    startIdx + perPageNum
  );

  const inversionistasResumen: any[] = [];

  for (const inv of pagedInversionistas) {
    // Buscar créditos de ese inversionista
    const creditosParticipa = await db
      .select({
        credito_id: creditos_inversionistas.credito_id,
        monto_aportado: creditos_inversionistas.monto_aportado,
        porcentaje_inversionista:
          creditos_inversionistas.porcentaje_participacion_inversionista,
        cuota_inversionista: creditos_inversionistas.cuota_inversionista,
      })
      .from(creditos_inversionistas)
      .where(
        eq(creditos_inversionistas.inversionista_id, inv.inversionista_id)
      );

    let subtotal = {
      total_abono_capital: new Big(0),
      total_abono_interes: new Big(0),
      total_abono_iva: new Big(0),
      total_isr: new Big(0),
      total_cuota: new Big(0),
      total_monto_aportado: new Big(0),
      totalAbonoGeneralInteres: new Big(0),
    };

    // Array para guardar la info de cada crédito
    const creditosData: any[] = [];

    for (const c of creditosParticipa) {
      // Info del crédito
      const [credito] = await db
        .select({
          numero_credito_sifco: creditos.numero_credito_sifco,
          nombre_usuario: usuarios.nombre,
          nit_usuario: usuarios.nit,
          capital: creditos.capital,
          porcentaje_interes: creditos.porcentaje_interes,
            meses_en_credito: sql<number>`
      GREATEST(
        0,
        (
          (DATE_PART('year', AGE(LEAST(COALESCE(${creditos.fecha_creacion}, CURRENT_DATE), CURRENT_DATE), ${creditos.fecha_creacion}))::int * 12)
          + DATE_PART('month', AGE(LEAST(COALESCE(${creditos.fecha_creacion}, CURRENT_DATE), CURRENT_DATE), ${creditos.fecha_creacion}))::int
          + CASE
              -- Contar el mes actual solo si ya pasamos (o es) el "día de corte" del inicio
              WHEN EXTRACT(DAY FROM LEAST(COALESCE(${creditos.fecha_creacion}, CURRENT_DATE), CURRENT_DATE))
                   >= EXTRACT(DAY FROM ${creditos.fecha_creacion})
              THEN 1 ELSE 0
            END
        )
      )
    `.as('meses_en_credito'),
          cuota_interes: creditos.cuota_interes,
          iva12: creditos.iva_12,
        })
        .from(creditos)
        .leftJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
        .where(eq(creditos.credito_id, c.credito_id))
        .limit(1);

      // Pagos NO LIQUIDADOS
      const pagos = await db
        .select({
          abono_capital: pagos_credito_inversionistas.abono_capital,
          abono_interes: pagos_credito_inversionistas.abono_interes,
          abono_iva_12: pagos_credito_inversionistas.abono_iva_12,
          fecha_pago: pagos_credito_inversionistas.fecha_pago,
          porcentaje_participacion:
            pagos_credito_inversionistas.porcentaje_participacion,
          abonoGeneralInteres: pagos_credito.abono_interes,
        })
        .from(pagos_credito_inversionistas)
        .innerJoin(
          pagos_credito,
          eq(pagos_credito_inversionistas.pago_id, pagos_credito.pago_id)
        )
        .where(
          and(
            eq(
              pagos_credito_inversionistas.inversionista_id,
              inv.inversionista_id
            ),
            eq(pagos_credito_inversionistas.credito_id, c.credito_id),
            eq(pagos_credito_inversionistas.estado_liquidacion, "NO_LIQUIDADO")
          )
        );

      // Totales de pagos de este crédito
      let total_abono_capital = new Big(0);
      let total_abono_interes = new Big(0);
      let total_abono_iva = new Big(0);
      let total_isr = new Big(0);
      let total_cuota = new Big(0);
      let total_monto_aportado = new Big(0);
      let totalAbonoGeneralInteres = new Big(0);

      const pagos_detalle = pagos.map((pago) => {
        const abono_capital = new Big(pago.abono_capital ?? 0);
        const abono_interes = new Big(pago.abono_interes ?? 0);
        const abono_iva = new Big(pago.abono_iva_12 ?? 0);
        const isr = abono_interes.times(0.05);
        const cuota_inversor = abono_capital
          .plus(abono_interes)
          .plus(inv.emite_factura ? abono_iva : isr.neg());
        const abonoGeneralInteres = abono_interes.plus(
            inv.emite_factura ? abono_iva : isr.neg()
          );  
        totalAbonoGeneralInteres = totalAbonoGeneralInteres.plus(abonoGeneralInteres)
        total_abono_capital = total_abono_capital.plus(abono_capital);
        total_abono_interes = total_abono_interes.plus(abono_interes);
        total_abono_iva = total_abono_iva.plus(abono_iva);
        total_isr = total_isr.plus(isr);
        total_cuota = total_cuota.plus(cuota_inversor);
        total_monto_aportado = total_monto_aportado.plus(c.monto_aportado ?? 0);
        return {
          mes: pago.fecha_pago?.toLocaleString("es-GT", { month: "long" }),
          abono_capital: abono_capital.toString(),
          abono_interes: abono_interes.toString(),
          abono_iva: abono_iva.toString(),
          isr: isr.toString(),
          porcentaje_inversor: pago.porcentaje_participacion,
          cuota_inversor: cuota_inversor.toString(),
          fecha_pago: pago.fecha_pago,
          cuota_inversionista: c.cuota_inversionista,
          abonoGeneralInteres: abono_interes.plus(
            inv.emite_factura ? abono_iva : isr.neg()
          ),
          tasaInteresInvesor: new Big(credito?.porcentaje_interes ?? 0).mul(
            pago.porcentaje_participacion
          ),
        };
      });

      // Suma a subtotal inversionista
      subtotal.total_monto_aportado =
        subtotal.total_monto_aportado.plus(total_monto_aportado);
      subtotal.total_abono_capital =
        subtotal.total_abono_capital.plus(total_abono_capital);
      subtotal.total_abono_interes =
        subtotal.total_abono_interes.plus(total_abono_interes);
      subtotal.total_abono_iva = subtotal.total_abono_iva.plus(total_abono_iva);
      subtotal.total_isr = subtotal.total_isr.plus(total_isr);
      subtotal.total_cuota = subtotal.total_cuota.plus(total_cuota);
      subtotal.totalAbonoGeneralInteres =
        subtotal.totalAbonoGeneralInteres.plus(totalAbonoGeneralInteres);
      const interes = new Big(credito?.cuota_interes ?? 0).plus(
        credito?.iva12 ?? 0
      );
      // Push detalle crédito
      creditosData.push({
        credito_id: c.credito_id,
        numero_credito_sifco: credito?.numero_credito_sifco,
        nombre_usuario: credito?.nombre_usuario,
        nit_usuario: credito?.nit_usuario,
        capital: credito?.capital,
        porcentaje_interes: credito?.porcentaje_interes,
        meses_en_credito: credito?.meses_en_credito,
        monto_aportado: c.monto_aportado,
        porcentaje_inversionista: c.porcentaje_inversionista,
        cuota_inversionista: c.cuota_inversionista,
        pagos: pagos_detalle,
        total_abono_capital: total_abono_capital.toString(),
        total_abono_interes: total_abono_interes.toString(),
        total_abono_iva: total_abono_iva.toString(),
        total_isr: total_isr.toString(),
        total_cuota: total_cuota.toString(),
        cuota_interes: interes.toString(),
      });
    }

    inversionistasResumen.push({
      inversionista_id: inv.inversionista_id,
      inversionista: inv.inversionista,
      emite_factura: inv.emite_factura,
      creditosData,
      subtotal: {
        total_abono_capital: subtotal.total_abono_capital.toString(),
        total_abono_interes: subtotal.total_abono_interes.toString(),
        total_abono_iva: subtotal.total_abono_iva.toString(),
        total_isr: subtotal.total_isr.toString(),
        total_cuota: subtotal.total_cuota.toString(),
        total_monto_aportado: subtotal.total_monto_aportado.toString(),
        total_abono_general_interes: subtotal.totalAbonoGeneralInteres.toString(),
      },
    });
  }

  return {
    inversionistas: inversionistasResumen,
    page: pageNum,
    perPage: perPageNum,
    totalItems,
    totalPages,
  };
}

export const liquidateByInvestorSchema = z.object({
  inversionista_id: z.number(),
});
/**
 * Liquida todos los pagos de un inversionista, cambiando su estado a "LIQUIDADO"
 * @param inversionista_id ID del inversionista cuyos pagos serán liquidados
 * @returns Un objeto con el mensaje y el número de registros actualizados
 * @throws Error si no se actualiza ningún registro
 */
export async function liquidateByInvestorId(inversionista_id: number) {
  console.log(
    `Liquidando todos los pagos para inversionista_id: ${inversionista_id}`
  );

  // Actualizar estado_liquidacion a "LIQUIDADO" para todos los pagos de ese inversionista
  const result = await db
    .update(pagos_credito_inversionistas)
    .set({
      estado_liquidacion: "LIQUIDADO",
    })
    .where(eq(pagos_credito_inversionistas.inversionista_id, inversionista_id));

  if (!result.rowCount || result.rowCount === 0) {
    throw new Error(
      "[ERROR] No se encontró ningún pago para liquidar con el inversionista_id dado"
    );
  }

  return {
    message: "Pagos liquidados correctamente",
    updatedCount: result.rowCount ?? 0,
  };
}

import dayjs from "dayjs";
import "dayjs/locale/es";
import { InversionistaReporte } from "../utils/interface";

dayjs.locale("es");

export function generarHTMLReporte(
  inversionista: InversionistaReporte,
  logoUrl: string = import.meta.env.LOGO_URL || ''
): string {
  const {
    inversionista: nombre,
    emite_factura,
    creditosData,
    subtotal,
  } = inversionista;
  const fechaHoy = dayjs().format("DD [de] MMMM YYYY");

  // Totales formateados
  const capitalActivo = creditosData
    .reduce((s, c) => s + parseFloat(c.monto_aportado || "0"), 0)
    .toLocaleString("es-GT", { style: "currency", currency: "GTQ" });
  const abonoCapital = subtotal.total_abono_capital
    ? parseFloat(subtotal.total_abono_capital).toLocaleString("es-GT", {
        style: "currency",
        currency: "GTQ",
      })
    : "";
  const abonoInteres = subtotal.total_abono_interes
    ? parseFloat(subtotal.total_abono_interes).toLocaleString("es-GT", {
        style: "currency",
        currency: "GTQ",
      })
    : "";
  const granTotal = subtotal.total_cuota
    ? parseFloat(subtotal.total_cuota).toLocaleString("es-GT", {
        style: "currency",
        currency: "GTQ",
      })
    : "";

  return `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <title>Reporte de Inversiones</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: 'Segoe UI', Arial, sans-serif;
      background: #fff;
    }
    .wrapper {
      width: 2450px;
      margin: 0 auto;
      background: #fff;
      padding: 0;
    }
    .header-row {
      display: flex;
      align-items: flex-start;
      padding: 36px 50px 8px 50px;
      width: 100%;
      box-sizing: border-box;
      justify-content: space-between;
      margin-bottom: 10px;
    }
    .logo {
      width: 210px;
      height: auto;
      margin-right: 32px;
    }
    .header-totals-row {
      flex: 1;
      display: flex;
      align-items: flex-end;
      justify-content: center;
      gap: 120px;
    }
    .header-total-block {
      text-align: center;
      min-width: 240px;
    }
    .header-total-value {
      font-size: 3.4rem;
      font-weight: bold;
      margin-bottom: 6px;
      color: #1d293b;
      line-height: 1.07;
      letter-spacing: 0.01em;
    }
    .header-total-label {
      color: #8c98b5;
      font-size: 1.33rem;
      margin-top: 2px;
      margin-bottom: 0px;
      font-weight: 400;
      letter-spacing: 0.01em;
    }
    .header-company-side {
      min-width: 160px;
      margin-left: 26px;
      margin-top: 12px;
      text-align: right;
    }
    .header-company-name {
      color: #215da8;
      font-size: 2.25rem;
      font-weight: bold;
      line-height: 2.8rem;
      margin-bottom: 10px;
    }
    .factura-label {
      color: #64748b;
      font-size: 1.18rem;
      margin-top: 4px;
      display: block;
    }
    .table-wrapper {
      margin-top: 22px;
      width: 100%;
      overflow-x: auto;
      background: #fff;
    }
    table {
      min-width: 2350px;
      border-collapse: collapse;
      width: 100%;
      background: #fff;
      font-size: 1.13rem;
    }
    thead th {
      background: #0485c2;
      color: #fff;
      font-weight: 700;
      font-size: 1.11rem;
      padding: 13px 5px;
      border-bottom: 2.5px solid #e0e7ef;
      white-space: nowrap;
      text-align: left;
    }
    td {
      font-size: 1.11rem;
      padding: 11px 4px;
      border-bottom: 1.1px solid #e0e7ef;
      white-space: nowrap;
      text-overflow: ellipsis;
      overflow: hidden;
      background: #fff;
      vertical-align: middle;
    }
    tr.total {
      font-weight: bold;
      background: #f0f9ff;
      font-size: 1.19rem;
    }
    .footer {
      color: #64748b;
      font-size: 1.11rem;
      margin-top: 28px;
      padding-left: 16px;
    }
    @media print {
      .wrapper, table {
        width: 2450px !important;
        min-width: 2450px !important;
        max-width: none !important;
      }
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="header-row">
      <div>
        ${
          logoUrl
            ? `<img src="${logoUrl}" class="logo" alt="Logo" />`
            : `<div class="logo" style="width:210px;height:70px;background:#e0e0e0;border-radius:12px;"></div>`
        }
      </div>
      <div class="header-totals-row">
        <div class="header-total-block">
          <div class="header-total-value">${capitalActivo}</div>
          <div class="header-total-label">Capital activo</div>
        </div>
        <div class="header-total-block">
          <div class="header-total-value">${abonoCapital}</div>
          <div class="header-total-label">Abono capital</div>
        </div>
        <div class="header-total-block">
          <div class="header-total-value">${abonoInteres}</div>
          <div class="header-total-label">Interés recibido</div>
        </div>
        <div class="header-total-block">
          <div class="header-total-value">${granTotal}</div>
          <div class="header-total-label">Gran total a recibir</div>
        </div>
      </div>
      <div class="header-company-side">
        <div class="header-company-name">${nombre}</div>
        <span class="factura-label">${
          emite_factura ? "Sí" : "No"
        } emite factura</span>
      </div>
    </div>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Meses en crédito</th>
            <th>Nombre</th>
            <th>Capital</th>
            <th>%</th>
            <th>% Inversionista</th>
            <th>TASA DE INTERÉS INVERSOR</th>
            <th>Cuota Inversionista</th>
            <th>IVA Inversionista</th>
            <th>ISR</th>
            <th>Abono capital</th>
            <th>% INVERSOR</th>
            <th>Capital restante</th>
            <th>CUOTA DE MES</th>
            <th>NIT</th>
          </tr>
        </thead>
        <tbody>
          ${creditosData
            .map((c) =>
              c.pagos && c.pagos.length > 0
                ? c.pagos
                    .map(
                      (pago) => `
                                <tr>
                                  <td>${c.meses_en_credito ?? ""}</td>
                                  <td>${c.nombre_usuario ?? ""}</td>
                          <td>
                  Q${Big(c.monto_aportado || 0)
                    .add(Big(pago.abono_capital || 0))
                    .toFixed(2)
                    .replace(/\B(?=(\d{3})+(?!\d))/g, ",")}
                </td>
                                  <td>${c.porcentaje_interes ?? ""} %</td>
                                  <td>${pago.porcentaje_inversor ?? ""} %</td>
                  <td>${pago.tasaInteresInvesor} %</td>
                  <td>Q${Number(pago.abono_interes ?? 0).toLocaleString(
                    "es-GT",
                    { minimumFractionDigits: 2 }
                  )}</td>
                  <td>Q${Number(pago.abono_iva ?? 0).toLocaleString("es-GT", {
                    minimumFractionDigits: 2,
                  })}</td>
                  <td>Q${Number(pago.isr ?? 0).toLocaleString("es-GT", {
                    minimumFractionDigits: 2,
                  })}</td>
                  <td>Q${Number(pago.abono_capital ?? 0).toLocaleString(
                    "es-GT",
                    { minimumFractionDigits: 2 }
                  )}</td>
                  <td>Q${Number(pago.abonoGeneralInteres ?? 0).toLocaleString(
                    "es-GT"
                  )}</td>
                              <td>
                  Q${Big(c.monto_aportado || 0)}
                </td>
                  <td>${pago.mes ?? ""}</td>
                  <td>${c.nit_usuario ?? ""}</td>
                </tr>
              `
                    )
                    .join("")
                : ""
            )
            .join("")}
          <tr class="total">
            <td>Total</td>
            <td></td>
            <td> </td>
            <td></td>
            <td></td>
            <td> </td>
            <td>${
              subtotal.total_abono_interes
                ? parseFloat(subtotal.total_abono_interes).toLocaleString(
                    "es-GT",
                    {
                      style: "currency",
                      currency: "GTQ",
                    }
                  )
                : ""
            }</td>
            <td>${
              subtotal.total_abono_iva
                ? parseFloat(subtotal.total_abono_iva).toLocaleString("es-GT", {
                    style: "currency",
                    currency: "GTQ",
                  })
                : ""
            }</td>
            <td>${
              subtotal.total_isr
                ? parseFloat(subtotal.total_isr).toLocaleString("es-GT", {
                    style: "currency",
                    currency: "GTQ",
                  })
                : ""
            }</td>
  <td>${
    subtotal.total_abono_capital
      ? parseFloat(subtotal.total_abono_capital).toLocaleString("es-GT", {
          style: "currency",
          currency: "GTQ",
        })
      : ""
  }</td>
          <td>${
            subtotal.total_abono_general_interes
              ? parseFloat(subtotal.total_abono_general_interes).toLocaleString("es-GT", {
                  style: "currency",
                  currency: "GTQ",
                })
              : ""
          }</td>
    <td>${
      subtotal.total_monto_aportado
        ? parseFloat(subtotal.total_monto_aportado).toLocaleString("es-GT", {
            style: "currency",
            currency: "GTQ",
          })
        : ""
    }</td>
            <td></td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div class="footer">
      Generado por Club Cashin.com · ${fechaHoy}
    </div>
  </div>
</body>
</html>
`;
}
