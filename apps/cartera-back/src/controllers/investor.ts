// app.ts (o donde declares tus rutas Elysia)
import { z } from "zod";
import { formatToUSD } from "../utils/functions/currencyConverter";
import { generarYSubirPDFInversionista, generarPDFBuffer } from "../utils/functions/generalFunctions";
import { db } from "../database/index";
import {
  bancos,
  boletasPagoInversionista,
  creditos,
  creditos_inversionistas,
  creditos_inversionistas_espejo,
  cuotas_credito,
  inversionistas,
  liquidaciones,
  pagos_credito,
  pagos_credito_inversionistas,
  pagos_credito_inversionistas_espejo, // 🆕 NUEVO: Tabla espejo de pagos
  platform_users,
  reinversiones,
  usuarios,
} from "../database/db/schema";
import { eq, and, sql, inArray, ilike, like, desc, count, SQL } from "drizzle-orm";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import Big from "big.js";
import { sendLiquidationEmail, sendSimpleEmail } from "@cci/email";

// ============================================
// 🆕 TIPOS Y CONFIGURACIÓN PARA CONSULTAS ORIGINALES/ESPEJO
// ============================================

// Tipo para origen de datos
type OrigenDatos = "original" | "espejo";

// Tipo para el parámetro tipo en consultas
export type TipoConsulta = "originales" | "espejos" | "ambas";

// 🔥 MEJORADO: Usar tipos genéricos de Drizzle para type-safety completo
type CreditosInversionistasTable = 
  | typeof creditos_inversionistas 
  | typeof creditos_inversionistas_espejo;

type PagosCreditoInversionistasTable = 
  | typeof pagos_credito_inversionistas 
  | typeof pagos_credito_inversionistas_espejo;

// Configuración de tablas según tipo
interface TablaConfig {
  creditosInversionistas: CreditosInversionistasTable;
  pagosCreditoInversionistas: PagosCreditoInversionistasTable;
  origen: OrigenDatos;
}

// Función helper para obtener configuración de tablas
function getTablaConfig(tipo: OrigenDatos): TablaConfig {
  if (tipo === "espejo") {
    return {
      creditosInversionistas: creditos_inversionistas_espejo,
      pagosCreditoInversionistas: pagos_credito_inversionistas_espejo,
      origen: "espejo"
    };
  }
  return {
    creditosInversionistas: creditos_inversionistas,
    pagosCreditoInversionistas: pagos_credito_inversionistas,
    origen: "original"
  };
}

// ============================================
// 🆕 FUNCIONES HELPER GENÉRICAS PARA CONSULTAS
// ============================================

// Función genérica para consultar créditos de inversionista
async function consultarCreditosInversionista(
  inversionistaIds: number[],
  config: TablaConfig
) {
  // 🔥 Type assertion segura: sabemos que ambas tablas tienen la misma estructura
  const tabla = config.creditosInversionistas as typeof creditos_inversionistas;
  
  return await db
    .select({
      credito_id: tabla.credito_id,
      inversionista_id: tabla.inversionista_id,
      monto_aportado: tabla.monto_aportado,
      porcentaje_inversionista: tabla.porcentaje_participacion_inversionista,
      cuota_inversionista: tabla.cuota_inversionista,
      origen: sql<OrigenDatos>`${config.origen}`.as('origen'),
    })
    .from(tabla)
    .where(inArray(tabla.inversionista_id, inversionistaIds));
}

// Función genérica para consultar pagos de inversionista
async function consultarPagosInversionista(
  inversionistaId: number,
  creditoId: number,
  incluirLiquidados: boolean,
  numeroCuota: number | undefined,
  config: TablaConfig,
  soloLiquidados = false,
  liquidacionId?: number
) {
  // 🔥 Type assertion segura: sabemos que ambas tablas tienen la misma estructura
  const tabla = config.pagosCreditoInversionistas as typeof pagos_credito_inversionistas;

  // 🔥 TIPADO: SQL[] es el tipo correcto para condiciones en Drizzle
  const pagosConditions: SQL[] = [
    eq(tabla.inversionista_id, inversionistaId),
    eq(tabla.credito_id, creditoId),
  ];

  if (liquidacionId) {
    pagosConditions.push(eq(tabla.liquidacion_id, liquidacionId));
    pagosConditions.push(eq(tabla.estado_liquidacion, "LIQUIDADO"));
  } else if (soloLiquidados) {
    pagosConditions.push(
      eq(tabla.estado_liquidacion, "LIQUIDADO")
    );
  } else if (!incluirLiquidados) {
    pagosConditions.push(
      eq(tabla.estado_liquidacion, "NO_LIQUIDADO")
    );
  }

  if (numeroCuota !== undefined) {
    pagosConditions.push(eq(cuotas_credito.numero_cuota, numeroCuota));
  }

  return await db
    .select({
      id: config.origen === "espejo" ? (tabla as any).id : sql<number>`0`,
      abono_capital: tabla.abono_capital,
      abono_interes: tabla.abono_interes,
      abono_iva_12: tabla.abono_iva_12,
      fecha_pago: tabla.fecha_pago,
      porcentaje_participacion: tabla.porcentaje_participacion,
      abonoGeneralInteres: pagos_credito.abono_interes,
      cuota: cuotas_credito.numero_cuota,
      estado_liquidacion: tabla.estado_liquidacion,
      fecha_vencimiento_cuota: cuotas_credito.fecha_vencimiento,
      fecha_pago_efectivo_cuota: cuotas_credito.fecha_liquidacion_inversionistas,
      origen: sql<OrigenDatos>`${config.origen}`.as('origen'),
    })
    .from(tabla)
    .innerJoin(
      pagos_credito,
      eq(tabla.pago_id, pagos_credito.pago_id)
    )
    .innerJoin(
      cuotas_credito,
      eq(pagos_credito.cuota_id, cuotas_credito.cuota_id)
    )
    .where(and(...pagosConditions));
}

// Función para combinar resultados de ambas fuentes (originales + espejos)
async function consultarCreditosAmbos(inversionistaIds: number[]) {
  const configOriginal = getTablaConfig("original");
  const configEspejo = getTablaConfig("espejo");

  const [creditosOriginales, creditosEspejos] = await Promise.all([
    consultarCreditosInversionista(inversionistaIds, configOriginal),
    consultarCreditosInversionista(inversionistaIds, configEspejo),
  ]);

  return [...creditosOriginales, ...creditosEspejos];
}

// Función para combinar pagos de ambas fuentes
async function consultarPagosAmbos(
  inversionistaId: number,
  creditoId: number,
  incluirLiquidados: boolean,
  numeroCuota: number | undefined,
  soloLiquidados = false,
  liquidacionId?: number
) {
  const configOriginal = getTablaConfig("original");
  const configEspejo = getTablaConfig("espejo");

  const [pagosOriginales, pagosEspejos] = await Promise.all([
    consultarPagosInversionista(inversionistaId, creditoId, incluirLiquidados, numeroCuota, configOriginal, soloLiquidados, liquidacionId),
    consultarPagosInversionista(inversionistaId, creditoId, incluirLiquidados, numeroCuota, configEspejo, soloLiquidados, liquidacionId),
  ]);

  return [...pagosOriginales, ...pagosEspejos];
}

// 🔥 Función BULK: consultar pagos de TODOS los créditos de un inversionista en UNA sola query
async function consultarPagosBulk(
  inversionistaId: number,
  creditosIds: number[],
  incluirLiquidados: boolean,
  numeroCuota: number | undefined,
  config: TablaConfig,
  soloLiquidados = false,
  liquidacionId?: number
) {
  const tabla = config.pagosCreditoInversionistas as typeof pagos_credito_inversionistas;

  const pagosConditions: SQL[] = [
    eq(tabla.inversionista_id, inversionistaId),
    inArray(tabla.credito_id, creditosIds),
  ];

  if (liquidacionId) {
    pagosConditions.push(eq(tabla.liquidacion_id, liquidacionId));
    pagosConditions.push(eq(tabla.estado_liquidacion, "LIQUIDADO"));
  } else if (soloLiquidados) {
    pagosConditions.push(eq(tabla.estado_liquidacion, "LIQUIDADO"));
  } else if (!incluirLiquidados) {
    pagosConditions.push(eq(tabla.estado_liquidacion, "NO_LIQUIDADO"));
  }

  if (numeroCuota !== undefined) {
    pagosConditions.push(eq(cuotas_credito.numero_cuota, numeroCuota));
  }

  return await db
    .select({
      credito_id: tabla.credito_id,
      abono_capital: tabla.abono_capital,
      abono_interes: tabla.abono_interes,
      abono_iva_12: tabla.abono_iva_12,
    })
    .from(tabla)
    .innerJoin(pagos_credito, eq(tabla.pago_id, pagos_credito.pago_id))
    .innerJoin(cuotas_credito, eq(pagos_credito.cuota_id, cuotas_credito.cuota_id))
    .where(and(...pagosConditions));
}

// 🔥 Función BULK para ambos orígenes
async function consultarPagosBulkAmbos(
  inversionistaId: number,
  creditosIds: number[],
  incluirLiquidados: boolean,
  numeroCuota: number | undefined,
  soloLiquidados = false,
  liquidacionId?: number
) {
  const [pagosOriginales, pagosEspejos] = await Promise.all([
    consultarPagosBulk(inversionistaId, creditosIds, incluirLiquidados, numeroCuota, getTablaConfig("original"), soloLiquidados, liquidacionId),
    consultarPagosBulk(inversionistaId, creditosIds, incluirLiquidados, numeroCuota, getTablaConfig("espejo"), soloLiquidados, liquidacionId),
  ]);
  return [...pagosOriginales, ...pagosEspejos];
}

// ============================================
// FIN DE CONFIGURACIÓN ORIGINALES/ESPEJO
// ============================================

export const insertInvestor = async ({ body, set }: any) => {
  try {
    const inversionistasToUpsert = Array.isArray(body) ? body : [body];

    if (inversionistasToUpsert.length === 0) {
      set.status = 400;
      return { message: "No se proporcionaron inversionistas para procesar." };
    }

    // 🔥 Validación flexible
    const errores: string[] = [];

    for (let index = 0; index < inversionistasToUpsert.length; index++) {
      const inv = inversionistasToUpsert[index];

      // 🔥 Debe venir DPI o nombre (al menos uno)
      if (!inv.dpi && !inv.nombre?.trim()) {
        errores.push(
          `Inversionista #${index + 1}: debe proporcionar DPI o nombre`
        );
      }
      // 🔥 Validar DPI si viene
      if (inv.dpi && (typeof inv.dpi !== "number" || inv.dpi < 0)) {
        errores.push(`Inversionista #${index + 1}: DPI inválido`);
      }
      // 🔥 Validar email si viene
      if (inv.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(inv.email)) {
        errores.push(`Inversionista #${index + 1}: email inválido`);
      }
      // 🔥 Validar emite_factura si viene
      if (
        inv.emite_factura !== undefined &&
        typeof inv.emite_factura !== "boolean"
      ) {
        errores.push(
          `Inversionista #${index + 1}: emite_factura debe ser boolean`
        );
      }

      // 🔥 Si viene banco (nombre o id), resolverlo
      if (inv.banco) {
        let banco_id = null;

        if (typeof inv.banco === "number") {
          const bancoExiste = await db
            .select()
            .from(bancos)
            .where(eq(bancos.banco_id, inv.banco))
            .limit(1);

          if (bancoExiste.length === 0) {
            errores.push(
              `Inversionista #${index + 1}: banco con ID ${inv.banco} no existe`
            );
          } else {
            banco_id = inv.banco;
          }
        } else if (typeof inv.banco === "string") {
          const nombreBanco = inv.banco.trim();

          const bancosCoincidentes = await db
            .select()
            .from(bancos)
            .where(ilike(bancos.nombre, `%${nombreBanco}%`))
            .limit(5);

          if (bancosCoincidentes.length === 0) {
            errores.push(
              `Inversionista #${index + 1}: no se encontró banco que coincida con "${nombreBanco}"`
            );
          } else if (bancosCoincidentes.length === 1) {
            banco_id = bancosCoincidentes[0].banco_id;
          } else {
            const matchExacto = bancosCoincidentes.find(
              (b) => b.nombre.toLowerCase() === nombreBanco.toLowerCase()
            );

            banco_id = matchExacto
              ? matchExacto.banco_id
              : bancosCoincidentes[0].banco_id;
          }
        } else {
          errores.push(
            `Inversionista #${index + 1}: banco debe ser ID (number) o nombre (string)`
          );
        }

        inv._banco_id = banco_id;
      }
    }

    if (errores.length > 0) {
      set.status = 400;
      return { message: "Errores de validación", errores };
    }

    const resultados: any[] = [];

    // 🔥 PROCESAR UNO POR UNO para manejar INSERT vs UPDATE
    for (const inv of inversionistasToUpsert) {
      // 🔥 Verificar si ya existe
      let existente = null;

      if (inv.dpi) {
        // Buscar por DPI primero
        const result = await db
          .select()
          .from(inversionistas)
          .where(eq(inversionistas.dpi, inv.dpi))
          .limit(1);
        existente = result[0] || null;
      }

      // Si no lo encontro por DPI, buscar por email
      if (!existente && inv.email?.trim()) {
        const result = await db
          .select()
          .from(inversionistas)
          .where(eq(inversionistas.email, inv.email.trim().toLowerCase()))
          .limit(1);
        existente = result[0] || null;
      }

      // Si no lo encontro por email, buscar por nombre
      if (!existente && inv.nombre?.trim()) {
        const result = await db
          .select()
          .from(inversionistas)
          .where(eq(inversionistas.nombre, inv.nombre.trim()))
          .limit(1);
        existente = result[0] || null;
      }

      if (existente) {
        // 🔥 YA EXISTE → UPDATE solo los campos que vienen
        const updateData: any = {};

        if (inv.nombre?.trim()) updateData.nombre = inv.nombre.trim();
        if (inv.email?.trim())
          updateData.email = inv.email.trim().toLowerCase();
        if (inv.emite_factura !== undefined)
          updateData.emite_factura = inv.emite_factura;
        if (inv.tipo_reinversion?.trim())
          updateData.tipo_reinversion = inv.tipo_reinversion.trim();
        if (inv._banco_id) updateData.banco_id = inv._banco_id;
        if (inv.tipo_cuenta?.trim())
          updateData.tipo_cuenta = inv.tipo_cuenta.trim();
        if (inv.numero_cuenta?.trim())
          updateData.numero_cuenta = inv.numero_cuenta.trim();
        if (inv.dpi) updateData.dpi = inv.dpi;
        if (inv.moneda?.trim()) updateData.moneda = inv.moneda.trim();
        if (inv.monto_reinversion !== undefined)
          updateData.monto_reinversion = inv.monto_reinversion;

        const [updated] = await db
          .update(inversionistas)
          .set(updateData)
          .where(
            eq(inversionistas.inversionista_id, existente.inversionista_id)
          )
          .returning();

        resultados.push(updated);
      } else {
        // 🔥 NO EXISTE → INSERT (requiere nombre obligatorio)
        const nombre = inv.nombre?.trim();

        if (!nombre) {
          // Si no hay nombre, saltamos este registro
          console.warn(`⚠️ Inversionista sin nombre para INSERT:`, inv);
          continue;
        }

        const insertData = {
          nombre,
          dpi: inv.dpi || null,
          email: inv.email?.trim().toLowerCase() || null,
          emite_factura: inv.emite_factura ?? false,
          tipo_reinversion: inv.tipo_reinversion?.trim() || "sin_reinversion",
          banco_id: inv._banco_id || null,
          tipo_cuenta: inv.tipo_cuenta?.trim() || null,
          numero_cuenta: inv.numero_cuenta?.trim() || null,
          moneda: inv.moneda?.trim() || "quetzales",
          monto_reinversion: inv.monto_reinversion || null,
        };

        const [inserted] = await db
          .insert(inversionistas)
          .values(insertData)
          .returning();

        resultados.push(inserted);
      }
    }

    set.status = 201;
    return {
      message: `Procesados exitosamente ${resultados.length} inversionista(s)`,
      data: resultados,
    };
  } catch (error: any) {
    console.error("Error upserting investors:", error);

    if (error.code === "23505") {
      const detalle = error.detail || "";
      if (detalle.includes("dpi")) {
        set.status = 409;
        return {
          message: "Ya existe un inversionista con ese DPI",
          error: "duplicate_dpi",
        };
      }
      if (detalle.includes("nombre")) {
        set.status = 409;
        return {
          message: "Ya existe un inversionista con ese nombre",
          error: "duplicate_nombre",
        };
      }
    }

    set.status = 500;
    return {
      message: "Error al procesar inversionistas",
      error: error.message || String(error),
    };
  }
};
// GET: Obtener inversionistas (uno o todos)
export const getInvestors = async ({ query, set }: any) => {
  try {
    // Buscar por ID
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
    if(query.email){  
      const result = await db
        .select()
        .from(inversionistas)
        .where(eq(inversionistas.email, query.email));
      set.status = result.length ? 200 : 404;
      return result.length
        ? result[0]
        : { message: "Inversionista no encontrado con ese email" };
    }

    // Buscar por DPI
    if (query.dpi) {
      const dpiNumber = parseInt(query.dpi);
      if (isNaN(dpiNumber)) {
        set.status = 400;
        return { message: "DPI debe ser un número válido" };
      }

      const result = await db
        .select()
        .from(inversionistas)
        .where(eq(inversionistas.dpi, dpiNumber));
      set.status = result.length ? 200 : 404;
      return result.length
        ? result[0]
        : { message: "Inversionista no encontrado con ese DPI" };
    }

    // Buscar por nombre
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
    console.error("Error al consultar inversionistas:", error);
    set.status = 500;
    return {
      message: "Error al consultar inversionistas",
      error: String(error),
    };
  }
};

export const updateSaldoReinversion = async ({ body, set }: any) => {
  try {
    const { inversionista_id, saldo_reinversion } = body;

    if (!inversionista_id || saldo_reinversion === undefined) {
      set.status = 400;
      return { message: "Se requiere inversionista_id y saldo_reinversion" };
    }

    const [updated] = await db
      .update(inversionistas)
      .set({ saldo_reinversion: String(saldo_reinversion) })
      .where(eq(inversionistas.inversionista_id, inversionista_id))
      .returning();

    if (!updated) {
      set.status = 404;
      return { message: "Inversionista no encontrado" };
    }

    set.status = 200;
    return updated;
  } catch (error) {
    console.error("Error al actualizar saldo_reinversion:", error);
    set.status = 500;
    return { message: "Error al actualizar saldo_reinversion", error: String(error) };
  }
};



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
  inversionista_id: number,
  updateMirror: boolean = false
) {


  // 1. Fetch credit details
  const credit = await db.query.creditos.findFirst({
    where: (c, { eq }) => eq(c.credito_id, credito_id),
  });

  if (!credit) {
    throw new Error("Credit not found");
  }

  // 1.5 Verificar si el inversionista tiene permite_distribucion
  const inversionista = await db.query.inversionistas.findFirst({
    where: (i, { eq }) => eq(i.inversionista_id, inversionista_id),
  });

  const permiteDistribucion = inversionista?.permite_distribucion ?? false;

  // 2. Fetch all investors for this credit
  // Determine which table to query based on updateMirror flag
  let investors;

  if (updateMirror) {
    investors = await db.query.creditos_inversionistas_espejo.findMany({
      where: (ci, { eq, and }) =>
        and(
          eq(ci.inversionista_id, inversionista_id),
          eq(ci.credito_id, credito_id)
        ),
    });
  } else {
    investors = await db.query.creditos_inversionistas.findMany({
      where: (ci, { eq, and }) =>
        and(
          eq(ci.inversionista_id, inversionista_id),
          eq(ci.credito_id, credito_id)
        ),
    });
  }

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
      porcentaje_cash_in: porcentajeCashIn.toString(),
      porcentaje_participacion_inversionista: porcentajeInversion.toString(),
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
    const setData = {
      cuota_inversionista: inv.cuota_inversionista,
      porcentaje_participacion_inversionista: inv.porcentaje_participacion_inversionista,
      monto_aportado: inv.monto_aportado,
      porcentaje_cash_in: inv.porcentaje_cash_in,
      iva_inversionista: inv.iva_inversionista,
      iva_cash_in: inv.iva_cash_in,
      monto_inversionista: inv.monto_inversionista,
      monto_cash_in: inv.monto_cash_in,
    };

    if (updateMirror) {
      await db.update(creditos_inversionistas_espejo).set(setData)
        .where(eq(creditos_inversionistas_espejo.id, inv.id));
    } else {
      await db.update(creditos_inversionistas).set(setData)
        .where(eq(creditos_inversionistas.id, inv.id));
    }

    // Si permite_distribucion = true, también actualizar la OTRA tabla con los mismos valores
    if (permiteDistribucion) {
      const otraTabla = updateMirror ? creditos_inversionistas : creditos_inversionistas_espejo;
      await db.update(otraTabla).set(setData)
        .where(and(
          eq(otraTabla.inversionista_id, inversionista_id),
          eq(otraTabla.credito_id, credito_id)
        ));
    }
  }

  // 6. Return the new updated data (could re-fetch if you want actual DB values)
  return processedInvestors;
}
export async function processAndReplaceCreditInvestorsReverse(
  credito_id: number,
  pago_id: number
) {
  // 1. Obtener crédito
  const credit = await db.query.creditos.findFirst({
    where: (c, { eq }) => eq(c.credito_id, credito_id),
  });

  if (!credit) {
    throw new Error("Credit not found");
  }

  // 2. Obtener todos los inversionistas del crédito
  const investors = await db.query.creditos_inversionistas.findMany({
    where: (ci, { eq }) => eq(ci.credito_id, credito_id),
  });

  if (investors.length === 0) {
    return [];
  }

  // 3. Obtener la cuota del pago
  const pago = await db.query.pagos_credito.findFirst({
    where: (p, { eq }) => eq(p.pago_id, pago_id),
  });

  if (!pago) {
    throw new Error(`Pago ${pago_id} no encontrado`);
  }

  // 4. Obtener TODOS los pagos de esa cuota
  const pagosDeEsaCuota = await db
    .select({ pago_id: pagos_credito.pago_id })
    .from(pagos_credito)
    .where(eq(pagos_credito.cuota_id, pago.cuota_id));

  const pagoIds = pagosDeEsaCuota.map((p) => p.pago_id);

  // 5. Por cada inversionista, sumar abono_capital de TODOS los pagos de esa cuota
  for (const inv of investors) {
    const abonos = pagoIds.length > 0
      ? await db
          .select({
            abono_capital: pagos_credito_inversionistas.abono_capital,
          })
          .from(pagos_credito_inversionistas)
          .where(
            and(
              inArray(pagos_credito_inversionistas.pago_id, pagoIds),
              eq(pagos_credito_inversionistas.inversionista_id, inv.inversionista_id)
            )
          )
      : [];

    if (abonos.length === 0) continue;

    const abonoCapitalInv = abonos.reduce(
      (acc, a) => acc.plus(new Big(a.abono_capital ?? 0)),
      new Big(0)
    );
    const montoAportado = new Big(inv.monto_aportado).plus(abonoCapitalInv);

    // Recalcular todo basado en el nuevo monto_aportado
    const porcentajeCashIn = new Big(inv.porcentaje_cash_in);
    const porcentajeInversion = new Big(inv.porcentaje_participacion_inversionista);

    const cuota = montoAportado
      .times(credit.porcentaje_interes)
      .div(100)
      .round(2);

    const montoInversionista = cuota.times(porcentajeInversion).div(100).round(2);
    const montoCashIn = cuota.times(porcentajeCashIn).div(100).round(2);

    const ivaInversionista = montoInversionista.gt(0)
      ? montoInversionista.times(0.12).round(2)
      : new Big(0);
    const ivaCashIn = montoCashIn.gt(0)
      ? montoCashIn.times(0.12).round(2)
      : new Big(0);

    await db
      .update(creditos_inversionistas)
      .set({
        monto_aportado: montoAportado.toFixed(2),
        monto_inversionista: montoInversionista.toFixed(2),
        monto_cash_in: montoCashIn.toFixed(2),
        iva_inversionista: ivaInversionista.toFixed(2),
        iva_cash_in: ivaCashIn.toFixed(2),
      })
      .where(eq(creditos_inversionistas.id, inv.id));
  }
}

export async function reversePagosEspejoPorInversionista(
  inversionista_id: number
) {
  console.log(
    `\n🔄 ========== INICIO reversePagosEspejoPorInversionista (inversionista: ${inversionista_id}) ==========`
  );

  // 1. Obtener TODOS los pagos del inversionista en la tabla espejo
  const pagosEspejo = await db
    .select()
    .from(pagos_credito_inversionistas_espejo)
    .where(eq(pagos_credito_inversionistas_espejo.inversionista_id, inversionista_id));

  console.log(`📊 Pagos encontrados en espejo: ${pagosEspejo.length}`);

  // 2. Obtener TODOS los créditos del inversionista en espejo (para cubrir créditos sin pagos pendientes)
  const creditosInvEspejo = await db
    .select()
    .from(creditos_inversionistas_espejo)
    .where(eq(creditos_inversionistas_espejo.inversionista_id, inversionista_id));

  console.log(`📂 Créditos del inversionista en espejo: ${creditosInvEspejo.length}`);

  // 3. Agrupar pagos por credito_id
  const pagosPorCredito: Record<number, typeof pagosEspejo> = {};
  for (const pago of pagosEspejo) {
    if (!pagosPorCredito[pago.credito_id]) {
      pagosPorCredito[pago.credito_id] = [];
    }
    pagosPorCredito[pago.credito_id].push(pago);
  }

  // 4. Por cada crédito del inversionista en espejo, revertir usando processAndReplaceCreditInvestors
  for (const invEspejo of creditosInvEspejo) {
    const creditoId = invEspejo.credito_id;
    const pagosDelCredito = pagosPorCredito[creditoId] || [];

    console.log(`\n--- 🏦 Procesando crédito ${creditoId} (${pagosDelCredito.length} pagos) ---`);

    // Sumar todos los abono_capital de los pagos de este crédito
    const totalAbonoCapital = pagosDelCredito.reduce(
      (acc, p) => acc.plus(new Big(p.abono_capital ?? 0)),
      new Big(0)
    );

    console.log(`   💰 Total abono_capital a revertir: ${totalAbonoCapital.toString()}`);
    console.log(`   📊 monto_aportado actual: ${invEspejo.monto_aportado}`);

    if (totalAbonoCapital.eq(0)) {
      console.log(`   ⏭️ Sin abono_capital que revertir, saltando...`);
      continue;
    }

    // addition: true porque sumamos de vuelta el abono_capital al monto_aportado
    await processAndReplaceCreditInvestors(
      creditoId,
      Number(totalAbonoCapital.toFixed(2)),
      true,
      inversionista_id,
      true // updateMirror
    );

    console.log(`   ✅ creditos_inversionistas_espejo actualizado para crédito ${creditoId}`);
  }

  // 5. Obtener cuotas asociadas a los pagos y marcarlas como NO liquidadas
  const pagoIds = [...new Set(pagosEspejo.map((p) => p.pago_id))];
  console.log(`\n📅 Revirtiendo liquidación de cuotas (${pagoIds.length} pago_ids únicos)...`);

  if (pagoIds.length > 0) {
    // Obtener los cuota_id de pagos_credito
    const pagosConCuota = await db
      .select({
        cuota_id: pagos_credito.cuota_id,
      })
      .from(pagos_credito)
      .where(inArray(pagos_credito.pago_id, pagoIds));

    const cuotaIds = [...new Set(
      pagosConCuota
        .map((p) => p.cuota_id)
        .filter((id): id is number => id !== null)
    )];

    console.log(`   📋 Cuotas a revertir: ${cuotaIds.length}`);

    if (cuotaIds.length > 0) {
      await db
        .update(cuotas_credito)
        .set({
          liquidado_inversionistas: false,
          fecha_liquidacion_inversionistas: null,
        })
        .where(inArray(cuotas_credito.cuota_id, cuotaIds));

      console.log(`   ✅ ${cuotaIds.length} cuotas marcadas como liquidado_inversionistas = false`);
    }
  }

  // 6. Eliminar TODOS los pagos del inversionista en espejo
  await db
    .delete(pagos_credito_inversionistas_espejo)
    .where(eq(pagos_credito_inversionistas_espejo.inversionista_id, inversionista_id));

  console.log(`\n🗑️ ${pagosEspejo.length} pagos eliminados de pagos_credito_inversionistas_espejo`);
  console.log(`✅ ========== FIN reversePagosEspejoPorInversionista ==========\n`);

  return {
    success: true,
    pagosRevertidos: pagosEspejo.length,
    creditosAfectados: creditosInvEspejo.length,
  };
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
  perPage = 10,
  numeroCreditoSifco?: string,
  nombreUsuario?: string,
  dpi?: string,
  incluirLiquidados = false,
  numeroCuota?: number,
  tipo: TipoConsulta = "originales",
  soloLiquidados = false,
  liquidacionId?: number
) {
  console.log(
    "resumeInvestor for",
    investorId,
    "DPI:",
    dpi,
    "Incluir liquidados:",
    incluirLiquidados,
    "Tipo:", // 🆕 Log del nuevo parámetro
    tipo
  );

  // 1. Consulta inversionista (por ID o DPI)
  let queryConditions = [];

  if (investorId) {
    queryConditions.push(eq(inversionistas.inversionista_id, investorId));
  }

  if (dpi) {
    queryConditions.push(eq(inversionistas.dpi, parseInt(dpi)));
  }

  // Si no hay ningún filtro, retornar vacío
  if (queryConditions.length === 0) {
    return { inversionistas: [], page, perPage, totalItems: 0, totalPages: 0 };
  }

  // 🔥 CAMBIO: Ahora hacemos JOIN con la tabla bancos
  const listaInversionistas = await db
    .select({
      inversionista_id: inversionistas.inversionista_id,
      inversionista: inversionistas.nombre,
      emite_factura: inversionistas.emite_factura,
      reinversion: inversionistas.tipo_reinversion,
      monto_reinversion: inversionistas.monto_reinversion,
      saldo_reinversion: inversionistas.saldo_reinversion,
      banco_id: inversionistas.banco_id,
      banco_nombre: bancos.nombre,
      tipo_cuenta: inversionistas.tipo_cuenta,
      numero_cuenta: inversionistas.numero_cuenta,
      dpi: inversionistas.dpi,
      moneda: inversionistas.moneda,
      email: inversionistas.email,
   tiene_boleta_pendiente: sql<boolean>`
      EXISTS (
        SELECT 1 
        FROM cartera.boletas_pago_inversionista 
        WHERE cartera.boletas_pago_inversionista.inversionista_id = ${inversionistas.inversionista_id}
        AND cartera.boletas_pago_inversionista.estado = 'PENDIENTE'
      )
    `.as('tiene_boleta_pendiente'),
    })
    .from(inversionistas)
    .leftJoin(bancos, eq(inversionistas.banco_id, bancos.banco_id))
    .where(and(...queryConditions))
    .limit(1);

  if (listaInversionistas.length === 0) {
    return { inversionistas: [], page, perPage, totalItems: 0, totalPages: 0 };
  }

  const inversionistaIds = listaInversionistas.map((i) => i.inversionista_id);

  // 2. Créditos asociados al inversionista
  // 🔥 NUEVO: Consultar según tipo (originales, espejos o ambas)
  let creditosParticipa;

  if (tipo === "ambas") {
    creditosParticipa = await consultarCreditosAmbos(inversionistaIds);
  } else {
    const config = getTablaConfig(tipo === "espejos" ? "espejo" : "original");
    creditosParticipa = await consultarCreditosInversionista(inversionistaIds, config);
  }

  let creditosIds = creditosParticipa.map((c) => c.credito_id);

  if (creditosIds.length === 0) {
    return { inversionistas: [], page, perPage, totalItems: 0, totalPages: 0 };
  }

  // 3. Info de créditos con filtros
  let conditions = [inArray(creditos.credito_id, creditosIds)];

  if (numeroCreditoSifco) {
    conditions.push(eq(creditos.numero_credito_sifco, numeroCreditoSifco));
  }

  if (nombreUsuario) {
    conditions.push(ilike(usuarios.nombre, `%${nombreUsuario}%`));
  }

  const creditosInfo = await db
    .select({
      credito_id: creditos.credito_id,
      numero_credito_sifco: creditos.numero_credito_sifco,
      nombre_usuario: usuarios.nombre,
      nit_usuario: usuarios.nit,
      capital: creditos.capital,
      porcentaje_interes: creditos.porcentaje_interes,
      cuota_interes: creditos.cuota_interes,
      iva12: creditos.iva_12,
      fecha_creacion: creditos.fecha_creacion,
      plazo: creditos.plazo,
    })
    .from(creditos)
    .leftJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
    .where(and(...conditions));

  creditosIds = creditosInfo.map((c) => c.credito_id);

  if (creditosIds.length === 0) {
    return { inversionistas: [], page, perPage, totalItems: 0, totalPages: 0 };
  }

  // 🚀 Paginación sobre créditos
  const totalItems = creditosIds.length;
  const totalPages = Math.ceil(totalItems / perPage);
  const creditosIdsPaginados = creditosIds.slice(
    (page - 1) * perPage,
    page * perPage
  );

  // 5️⃣ Armar estructura final
  const inversionistasResumen = await Promise.all(
    listaInversionistas.map(async (inv) => {
      // Créditos del inversionista dentro de la página actual
      const creditosDeInv = creditosParticipa.filter(
        (c) =>
          c.inversionista_id === inv.inversionista_id &&
          creditosIdsPaginados.includes(c.credito_id)
      );

      // Inicializar subtotales
      let subtotal = {
        total_abono_capital: new Big(0),
        total_abono_interes: new Big(0),
        total_abono_iva: new Big(0),
        total_isr: new Big(0),
        total_cuota: new Big(0),
        total_monto_aportado: new Big(0),
        totalAbonoGeneralInteres: new Big(0),
        total_capital_creditos: new Big(0),
        total_capital_actual: new Big(0),
      };

      const formatValue = (val: string | number | null | undefined) =>
        inv.moneda === "dolares" ? formatToUSD(val) : Number(val || 0);

      // Procesar créditos del inversionista
      const creditosData = await Promise.all(
        creditosDeInv.map(async (c) => {
          // 📌 Obtener info del crédito
          const [credito] = await db
            .select({
              numero_credito_sifco: creditos.numero_credito_sifco,
              nombre_usuario: usuarios.nombre,
              nit_usuario: usuarios.nit,
              capital: creditos.capital,
              fecha_creacion: creditos.fecha_creacion,
              porcentaje_interes: creditos.porcentaje_interes,
              plazo: creditos.plazo,
              cuota_interes: creditos.cuota_interes,
              iva12: creditos.iva_12,
            })
            .from(creditos)
            .leftJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
            .where(eq(creditos.credito_id, c.credito_id))
            .limit(1);

          // 📌 Pagos (liquidados o no según el parámetro)
          // 🔥 NUEVO: Consultar según tipo (originales, espejos o ambas)
          let pagos;

          if (tipo === "ambas") {
            pagos = await consultarPagosAmbos(
              inv.inversionista_id,
              c.credito_id,
              incluirLiquidados,
              numeroCuota,
              soloLiquidados,
              liquidacionId
            );
          } else {
            const config = getTablaConfig(tipo === "espejos" ? "espejo" : "original");
            pagos = await consultarPagosInversionista(
              inv.inversionista_id,
              c.credito_id,
              incluirLiquidados,
              numeroCuota,
              config,
              soloLiquidados,
              liquidacionId
            );
          }

          // 📊 Totales del crédito
          let total_abono_capital = new Big(0);
          let total_abono_interes = new Big(0);
          let total_abono_iva = new Big(0);
          let total_isr = new Big(0);
          let total_cuota = new Big(0);
          let total_monto_aportado = new Big(c.monto_aportado ?? 0);
          let totalAbonoGeneralInteres = new Big(0);

          // 🆕 Capital del crédito y capital actual
          const capital_credito = new Big(credito?.capital ?? 0);

          // ✅ Cálculo de meses_en_credito con dayjs
          let meses_en_credito: number | null = null;
          if (credito?.fecha_creacion) {
            const inicio = dayjs(credito.fecha_creacion);
            const hoy = dayjs();
            meses_en_credito = hoy.diff(inicio, "month");
          }

          // 🧮 Detalle de pagos
          const pagos_detalle = pagos
            .sort((a, b) => {
              // 🔥 ORDENAR POR FECHA DE VENCIMIENTO DE LA CUOTA
              if (!a.fecha_vencimiento_cuota) return 1;
              if (!b.fecha_vencimiento_cuota) return -1;
              const fechaA = new Date(a.fecha_vencimiento_cuota).getTime();
              const fechaB = new Date(b.fecha_vencimiento_cuota).getTime();
              return fechaA - fechaB;
            })
            .map((pago) => {
              const abono_capital = new Big(pago.abono_capital ?? 0);
              const abono_interes = new Big(pago.abono_interes ?? 0);
              const abono_iva = new Big(pago.abono_iva_12 ?? 0);
              const isr = abono_interes.times(0.07).round(2);
              const cuota = pago.cuota ?? 0;
              let cuota_inversor;
              let abonoGeneralInteres;

              // 🔥 USAR FECHA DE LA CUOTA PARA EL MES (prioridad: fecha_pago_efectivo, luego fecha_vencimiento)
        const fechaParaMes = pago.fecha_vencimiento_cuota || pago.fecha_vencimiento_cuota;
const mes = fechaParaMes
  ? dayjs(fechaParaMes).format('MMMM') // 🔥 Esto da el mes correcto
  : null;
  console.log("Fecha para mes:", fechaParaMes, "→ Mes:", mes);
       // 🆕 CORRECCIÓN: Cálculo según emite_factura
              if (inv.emite_factura) {
                abonoGeneralInteres = abono_interes.plus(abono_iva);
              } else {
                abonoGeneralInteres = abono_interes.minus(isr);
              }

              switch (inv.reinversion) {
                case "sin_reinversion":
                  cuota_inversor = abono_capital
                    .plus(abono_interes)
                    .plus(inv.emite_factura ? abono_iva : isr.neg());
                  break;

                case "reinversion_capital":
                  cuota_inversor = abono_interes.plus(
                    inv.emite_factura ? abono_iva : isr.neg()
                  );
                  break;

                case "reinversion_interes":
                  cuota_inversor = abono_capital.plus(
                    inv.emite_factura ? abono_iva : isr.neg()
                  );
                  break;

                case "reinversion_total":
                  cuota_inversor = new Big(0);
                  break;

                case "reinversion_variable":
                  // Se calcula como sin_reinversion per-pago; el tope global se aplica después
                  cuota_inversor = abono_capital
                    .plus(abono_interes)
                    .plus(inv.emite_factura ? abono_iva : isr.neg());
                  break;

                default:
                  cuota_inversor = abono_capital
                    .plus(abono_interes)
                    .plus(inv.emite_factura ? abono_iva : isr.neg());
              }

              // 🆕 CORRECCIÓN: Acumular totales
              totalAbonoGeneralInteres =
                totalAbonoGeneralInteres.plus(abonoGeneralInteres);
              total_abono_capital = total_abono_capital.plus(abono_capital);
              total_abono_interes = total_abono_interes.plus(abono_interes);
              total_abono_iva = total_abono_iva.plus(abono_iva);

              if (inv.emite_factura) {
                // ISR se queda en 0
              } else {
                total_isr = total_isr.plus(isr);
              }

              total_cuota = total_cuota.plus(cuota_inversor);

              return {
                id: (pago as any).id,
                mes, // 🔥 AHORA USA LA FECHA DE LA CUOTA
                abono_capital: formatValue(abono_capital.toString()),
                abono_interes: formatValue(abono_interes.toString()),
                abono_iva: formatValue(abono_iva.toString()),
                isr: inv.emite_factura ? 0 : formatValue(isr.toString()),
                porcentaje_inversor: pago.porcentaje_participacion,
                cuota_inversor: formatValue(cuota_inversor.toString()),
                cuota: formatValue(cuota),
                fecha_pago: pago.fecha_pago,
                fecha_vencimiento_cuota: pago.fecha_vencimiento_cuota, // 🔥 NUEVA
                fecha_pago_efectivo_cuota: pago.fecha_pago_efectivo_cuota, // 🔥 NUEVA
                cuota_inversionista: formatValue(c.cuota_inversionista),
                abonoGeneralInteres: formatValue(abonoGeneralInteres.toString()),
                tasaInteresInvesor: Number(
                  new Big(credito?.porcentaje_interes ?? 0).mul(
                    pago.porcentaje_participacion
                  )
                ),
                estado_liquidacion: pago.estado_liquidacion,
              };
            });

          // 🆕 Calcular capital actual (capital - total_abono_capital)
          const capital_actual = capital_credito.minus(total_abono_capital);

          // Acumular subtotales
          subtotal.total_monto_aportado =
            subtotal.total_monto_aportado.plus(total_monto_aportado);
          subtotal.total_abono_capital =
            subtotal.total_abono_capital.plus(total_abono_capital);
          subtotal.total_abono_interes =
            subtotal.total_abono_interes.plus(total_abono_interes);
          subtotal.total_abono_iva =
            subtotal.total_abono_iva.plus(total_abono_iva);
          subtotal.total_isr = subtotal.total_isr.plus(total_isr);
          subtotal.total_cuota = subtotal.total_cuota.plus(total_cuota);
          subtotal.totalAbonoGeneralInteres =
            subtotal.totalAbonoGeneralInteres.plus(totalAbonoGeneralInteres);
          subtotal.total_capital_creditos =
            subtotal.total_capital_creditos.plus(capital_credito);
          subtotal.total_capital_actual =
            subtotal.total_capital_actual.plus(capital_actual);

          return {
            credito_id: c.credito_id,
            numero_credito_sifco: credito?.numero_credito_sifco,
            nombre_usuario: credito?.nombre_usuario,
            nit_usuario: credito?.nit_usuario,
            capital: formatValue(credito?.capital),
            capital_actual: formatValue(capital_actual.toString()),
            porcentaje_interes: credito?.porcentaje_interes,
            cuota_interes: formatValue(credito?.cuota_interes),
            iva12: formatValue(credito?.iva12),
            fecha_creacion: credito?.fecha_creacion,
            monto_aportado: formatValue(c.monto_aportado),
            porcentaje_inversionista: c.porcentaje_inversionista,
            cuota_inversionista: formatValue(c.cuota_inversionista),
            plazo: credito.plazo,
            pagos: pagos_detalle,
            total_abono_capital: formatValue(total_abono_capital.toString()),
            total_abono_interes: formatValue(total_abono_interes.toString()),
            total_abono_iva: formatValue(total_abono_iva.toString()),
            total_isr: formatValue(total_isr.toString()),
            total_cuota: formatValue(total_cuota.toString()),
            meses_en_credito,
            origen: c.origen, // 🆕 NUEVO: Indica si viene de tabla original o espejo
          };
        })
      );

      // Aplicar reinversión variable como tope global sobre el total
      if (inv.reinversion === "reinversion_variable") {
        const montoReinv = new Big(inv.monto_reinversion ?? 0);
        const reinversion = montoReinv.gt(subtotal.total_cuota) ? subtotal.total_cuota : montoReinv;
        subtotal.total_cuota = subtotal.total_cuota.minus(reinversion);
      }

      // 🔹 Retornar estructura del inversionista
      return {
        inversionista_id: inv.inversionista_id,
        nombre_inversionista: inv.inversionista,
        emite_factura: inv.emite_factura,
        banco_id: inv.banco_id,
        banco: inv.banco_nombre,
        tipo_cuenta: inv.tipo_cuenta,
        numero_cuenta: inv.numero_cuenta,
        re_inversion: inv.reinversion,
        monto_reinversion: inv.monto_reinversion,
        saldo_reinversion: inv.saldo_reinversion,
        tieneBoletaPendiente: inv.tiene_boleta_pendiente,
        dpi: inv.dpi,
        moneda: inv.moneda,
        email: inv.email,
        currencySymbol: inv.moneda === "dolares" ? "$" : "Q.",
        creditos: creditosData,
        subtotal: {
          total_abono_capital: formatValue(subtotal.total_abono_capital.toString()),
          total_abono_interes: formatValue(subtotal.total_abono_interes.toString()),
          total_abono_iva: formatValue(subtotal.total_abono_iva.toString()),
          total_isr: formatValue(subtotal.total_isr.toString()),
          total_cuota: formatValue(subtotal.total_cuota.toString()),
          total_monto_aportado: formatValue(subtotal.total_monto_aportado.toString()),
          total_abono_general_interes: formatValue(subtotal.totalAbonoGeneralInteres.toString()),
          total_capital_creditos: formatValue(subtotal.total_capital_creditos.toString()),
          total_capital_actual: formatValue(subtotal.total_capital_actual.toString()),
        },
      };
    })
  );

  return {
    inversionistas: inversionistasResumen,
    page,
    perPage,
    totalItems,
    totalPages,
  };
}

/**
 * 🆕 NUEVA FUNCIÓN: Obtiene los totales globales de un inversionista SIN paginación
 * Calcula las sumas de TODOS los créditos y pagos del inversionista
 */
export async function getInvestorTotalsGlobales(
  investorId?: number,
  dpi?: string,
  tipo: TipoConsulta = "originales",
  incluirLiquidados = false,
  numeroCuota?: number,
  soloLiquidados = false,
  liquidacionId?: number
) {
  console.log(
    "getInvestorTotalsGlobales for",
    investorId,
    "DPI:",
    dpi,
    "Tipo:",
    tipo
  );

  // 1. Consulta inversionista (por ID o DPI)
  let queryConditions = [];

  if (investorId) {
    queryConditions.push(eq(inversionistas.inversionista_id, investorId));
  }

  if (dpi) {
    queryConditions.push(eq(inversionistas.dpi, parseInt(dpi)));
  }

  if (queryConditions.length === 0) {
    throw new Error("Debe proporcionar al menos 'id' o 'dpi'");
  }

  const listaInversionistas = await db
    .select({
      inversionista_id: inversionistas.inversionista_id,
      inversionista: inversionistas.nombre,
      emite_factura: inversionistas.emite_factura,
      reinversion: inversionistas.tipo_reinversion,
      monto_reinversion: inversionistas.monto_reinversion,
      moneda: inversionistas.moneda,
    })
    .from(inversionistas)
    .where(and(...queryConditions))
    .limit(1);

  if (listaInversionistas.length === 0) {
    throw new Error("Inversionista no encontrado");
  }

  const inv = listaInversionistas[0];
  const inversionistaIds = [inv.inversionista_id];

  // 2. Créditos asociados al inversionista (según tipo)
  let creditosParticipa;

  if (tipo === "ambas") {
    creditosParticipa = await consultarCreditosAmbos(inversionistaIds);
  } else {
    const config = getTablaConfig(tipo === "espejos" ? "espejo" : "original");
    creditosParticipa = await consultarCreditosInversionista(inversionistaIds, config);
  }

  let creditosIds = creditosParticipa.map((c) => c.credito_id);

  const formatValue = (val: string | number) => inv.moneda === "dolares" ? formatToUSD(val) : Number(val);

  if (creditosIds.length === 0) {
    return {
      inversionista_id: inv.inversionista_id,
      nombre_inversionista: inv.inversionista,
      moneda: inv.moneda,
      currencySymbol: inv.moneda === "dolares" ? "$" : "Q.",
      totales: {
        total_abono_capital: 0,
        total_abono_interes: 0,
        total_abono_iva: 0,
        total_isr: 0,
        total_cuota: 0,
        total_monto_aportado: 0,
        totalAbonoGeneralInteres: 0,
        total_capital_creditos: 0,
        total_capital_actual: 0,
      },
    };
  }

  // 3. Info de créditos con filtros (igual que resumeInvestor)
  let conditions = [inArray(creditos.credito_id, creditosIds)];

  const creditosInfo = await db
    .select({
      credito_id: creditos.credito_id,
      capital: creditos.capital,
      porcentaje_interes: creditos.porcentaje_interes,
      fecha_creacion: creditos.fecha_creacion,
    })
    .from(creditos)
    .where(and(...conditions));

  creditosIds = creditosInfo.map((c) => c.credito_id);

  if (creditosIds.length === 0) {
    return {
      inversionista_id: inv.inversionista_id,
      nombre_inversionista: inv.inversionista,
      moneda: inv.moneda,
      currencySymbol: inv.moneda === "dolares" ? "$" : "Q.",
      totales: {
        total_abono_capital: 0,
        total_abono_interes: 0,
        total_abono_iva: 0,
        total_isr: 0,
        total_cuota: 0,
        total_monto_aportado: 0,
        totalAbonoGeneralInteres: 0,
        total_capital_creditos: 0,
        total_capital_actual: 0,
      },
    };
  }

  // 4. 🔥 IMPORTANTE: NO PAGINAR - Usar TODOS los créditos
  const creditosDeInv = creditosParticipa.filter(
    (c) => c.inversionista_id === inv.inversionista_id && creditosIds.includes(c.credito_id)
  );

  // 5. 🔥 OPTIMIZACIÓN: Obtener TODOS los pagos en UNA sola query (en vez de N queries)
  let todosPagos;
  if (tipo === "ambas") {
    todosPagos = await consultarPagosBulkAmbos(
      inv.inversionista_id,
      creditosIds,
      incluirLiquidados,
      numeroCuota,
      soloLiquidados,
      liquidacionId
    );
  } else {
    const config = getTablaConfig(tipo === "espejos" ? "espejo" : "original");
    todosPagos = await consultarPagosBulk(
      inv.inversionista_id,
      creditosIds,
      incluirLiquidados,
      numeroCuota,
      config,
      soloLiquidados,
      liquidacionId
    );
  }

  // Agrupar pagos por credito_id en un Map para acceso O(1)
  const pagosPorCredito = new Map<number, typeof todosPagos>();
  for (const pago of todosPagos) {
    const arr = pagosPorCredito.get(pago.credito_id) ?? [];
    arr.push(pago);
    pagosPorCredito.set(pago.credito_id, arr);
  }

  // 6. Inicializar subtotales
  let subtotal = {
    total_abono_capital: new Big(0),
    total_abono_interes: new Big(0),
    total_abono_iva: new Big(0),
    total_isr: new Big(0),
    total_cuota: new Big(0),
    total_monto_aportado: new Big(0),
    totalAbonoGeneralInteres: new Big(0),
    total_capital_creditos: new Big(0),
    total_capital_actual: new Big(0),
    total_reinversion_capital: new Big(0),
    total_reinversion_interes: new Big(0),
    total_reinversion: new Big(0),
  };

  // 7. Procesar TODOS los créditos del inversionista (sin queries adicionales)
  for (const c of creditosDeInv) {
    const credito = creditosInfo.find((cr) => cr.credito_id === c.credito_id);
    if (!credito) continue;

    const pagos = pagosPorCredito.get(c.credito_id) ?? [];

    // Saltar créditos sin pagos cuando se filtra por estado
    if (pagos.length === 0) continue;

    // Sumar totales
    const capital_credito = new Big(credito?.capital ?? 0);
    let capital_actual = capital_credito;

    for (const pago of pagos) {
      const abono_capital = new Big(pago.abono_capital ?? 0);
      const abono_interes = new Big(pago.abono_interes ?? 0);
      const abono_iva = new Big(pago.abono_iva_12 ?? 0);
      const isr = abono_interes.times(0.07).round(2);

      let abonoGeneralInteres;
      if (inv.emite_factura) {
        abonoGeneralInteres = abono_interes.plus(abono_iva);
      } else {
        abonoGeneralInteres = abono_interes.minus(isr);
      }

      let cuota_inversor;
      let reinvCapital = new Big(0);
      let reinvInteres = new Big(0);
      const interesTotal = abono_interes.plus(inv.emite_factura ? abono_iva : isr.neg());

      switch (inv.reinversion) {
        case "sin_reinversion":
          cuota_inversor = abono_capital.plus(interesTotal);
          break;
        case "reinversion_capital":
          reinvCapital = abono_capital;
          cuota_inversor = interesTotal;
          break;
        case "reinversion_interes":
          reinvInteres = abono_interes;
          cuota_inversor = abono_capital.plus(inv.emite_factura ? abono_iva : isr.neg());
          break;
        case "reinversion_total":
          reinvCapital = abono_capital;
          reinvInteres = abono_interes;
          cuota_inversor = new Big(0);
          break;
        case "reinversion_variable":
          // Se calcula como sin_reinversion per-pago; el tope global se aplica después
          cuota_inversor = abono_capital.plus(interesTotal);
          break;
        default:
          cuota_inversor = abono_capital.plus(interesTotal);
      }

      capital_actual = capital_actual.minus(abono_capital);

      subtotal.total_abono_capital = subtotal.total_abono_capital.plus(abono_capital);
      subtotal.total_abono_interes = subtotal.total_abono_interes.plus(abono_interes);
      subtotal.total_abono_iva = subtotal.total_abono_iva.plus(abono_iva);
      subtotal.total_isr = subtotal.total_isr.plus(isr);
      subtotal.total_cuota = subtotal.total_cuota.plus(cuota_inversor);
      subtotal.totalAbonoGeneralInteres = subtotal.totalAbonoGeneralInteres.plus(abonoGeneralInteres);
      subtotal.total_reinversion_capital = subtotal.total_reinversion_capital.plus(reinvCapital);
      subtotal.total_reinversion_interes = subtotal.total_reinversion_interes.plus(reinvInteres);
      subtotal.total_reinversion = subtotal.total_reinversion.plus(reinvCapital).plus(reinvInteres);
    }

    subtotal.total_monto_aportado = subtotal.total_monto_aportado.plus(new Big(c.monto_aportado ?? 0));
    subtotal.total_capital_creditos = subtotal.total_capital_creditos.plus(capital_credito);
    subtotal.total_capital_actual = subtotal.total_capital_actual.plus(capital_actual);
  }

  // Aplicar reinversión variable como tope global sobre el total
  if (inv.reinversion === "reinversion_variable") {
    const montoReinv = new Big(inv.monto_reinversion ?? 0);
    const reinversion = montoReinv.gt(subtotal.total_cuota) ? subtotal.total_cuota : montoReinv;
    subtotal.total_reinversion = reinversion;
    subtotal.total_cuota = subtotal.total_cuota.minus(reinversion);
  }

  // 7. Upsert en reinversiones
  const existeReinversion = await db.query.reinversiones.findFirst({
    where: (r, { eq }) => eq(r.inversionista_id, inv.inversionista_id),
  });

  if (existeReinversion) {
    await db.update(reinversiones)
      .set({
        monto_capital: subtotal.total_reinversion_capital.toFixed(2),
        monto_interes: subtotal.total_reinversion_interes.toFixed(2),
        monto_total: subtotal.total_reinversion.toFixed(2),
        tipo_reinversion: inv.reinversion,
      })
      .where(eq(reinversiones.inversionista_id, inv.inversionista_id));
  } else {
    await db.insert(reinversiones).values({
      inversionista_id: inv.inversionista_id,
      monto_capital: subtotal.total_reinversion_capital.toFixed(2),
      monto_interes: subtotal.total_reinversion_interes.toFixed(2),
      monto_total: subtotal.total_reinversion.toFixed(2),
      tipo_reinversion: inv.reinversion,
    });
  }

  // 8. Retornar solo los totales
  return {
    inversionista_id: inv.inversionista_id,
    nombre_inversionista: inv.inversionista,
    moneda: inv.moneda,
    currencySymbol: inv.moneda === "dolares" ? "$" : "Q.",
    totales: {
      total_abono_capital: formatValue(subtotal.total_abono_capital.toString()),
      total_abono_interes: formatValue(subtotal.total_abono_interes.toString()),
      total_abono_iva: formatValue(subtotal.total_abono_iva.toString()),
      total_isr: formatValue(subtotal.total_isr.toString()),
      total_cuota_sin_reinversion: formatValue(subtotal.total_cuota.plus(subtotal.total_reinversion).toString()),
      total_cuota_con_reinversion: formatValue(subtotal.total_cuota.toString()),
      total_monto_aportado: formatValue(subtotal.total_monto_aportado.toString()),
      total_abono_general_interes: formatValue(subtotal.totalAbonoGeneralInteres.toString()),
      total_capital_creditos: formatValue(subtotal.total_capital_creditos.toString()),
      total_capital_actual: formatValue(subtotal.total_capital_actual.toString()),
      total_reinversion_capital: formatValue(subtotal.total_reinversion_capital.toString()),
      total_reinversion_interes: formatValue(subtotal.total_reinversion_interes.toString()),
      total_reinversion: formatValue(subtotal.total_reinversion.toString()),
    },
  };
}

export async function updateLiquidacionReporteUrl(inversionistaId: number, url: string) {
  const [liquidacion] = await db
    .select({
      liquidacion_id: liquidaciones.liquidacion_id,
      fecha_liquidacion: liquidaciones.fecha_liquidacion,
      reporte_liquidacion_url: liquidaciones.reporte_liquidacion_url,
    })
    .from(liquidaciones)
    .where(eq(liquidaciones.inversionista_id, inversionistaId))
    .orderBy(desc(liquidaciones.fecha_liquidacion))
    .limit(1);

  if (liquidacion) {
    await db
      .update(liquidaciones)
      .set({ reporte_liquidacion_url: url })
      .where(eq(liquidaciones.liquidacion_id, liquidacion.liquidacion_id));

    return {
      liquidacion_id: liquidacion.liquidacion_id,
      fecha_liquidacion: liquidacion.fecha_liquidacion,
      url_anterior: liquidacion.reporte_liquidacion_url,
      url_nueva: url,
    };
  }

  return null;
}

// ============================================
// upsertPagosEspejo
// ============================================

/**
 * Recibe un array de pagos con su `id` (PK de pagos_credito_inversionistas_espejo)
 * y actualiza los campos financieros de cada uno.
 *
 * Validación previa: verifica que todos los ids existan en la BD antes de
 * hacer cualquier UPDATE. Si alguno no existe, lanza un error descriptivo.
 *
 * No toca ninguna otra tabla.
 *
 * @param pagos - Array de pagos a actualizar (deben existir en la BD)
 */
export async function upsertPagosEspejo(
  pagos: {
    id: number;
    abono_capital: string;
    abono_interes: string;
    porcentaje_participacion: string;
    cuota: string;
    estado_liquidacion?: "NO_LIQUIDADO" | "LIQUIDADO";
  }[]
) {
  if (pagos.length === 0) {
    return { actualizados: 0 };
  }

  // ── PASO 1: Validar que todos los ids existen ────────────────────────────────
  const ids = pagos.map((p) => p.id);

  const encontrados = await db
    .select({ id: pagos_credito_inversionistas_espejo.id })
    .from(pagos_credito_inversionistas_espejo)
    .where(inArray(pagos_credito_inversionistas_espejo.id, ids));

  const idsEncontrados = new Set(encontrados.map((r) => r.id));
  const idsNoEncontrados = ids.filter((id) => !idsEncontrados.has(id));

  if (idsNoEncontrados.length > 0) {
    throw new Error(
      `Los siguientes ids no existen en pagos_credito_inversionistas_espejo: [${idsNoEncontrados.join(", ")}]`
    );
  }

  // ── PASO 2: UPDATE por id para cada pago ────────────────────────────────────
  await Promise.all(
    pagos.map((p) => {
      // 🆕 Recalcular IVA basado en el interés (Siempre 12%)
      const numericInteres = Number(p.abono_interes) || 0;
      const calculadoIva = (numericInteres * 0.12).toFixed(2);

      return db
        .update(pagos_credito_inversionistas_espejo)
        .set({
          abono_capital:            p.abono_capital,
          abono_interes:            p.abono_interes,
          abono_iva_12:             calculadoIva,
          porcentaje_participacion: p.porcentaje_participacion,
          cuota:                    p.cuota,
          ...(p.estado_liquidacion && { estado_liquidacion: p.estado_liquidacion }),
        })
        .where(eq(pagos_credito_inversionistas_espejo.id, p.id));
    })
  );

  console.log(`[upsertPagosEspejo] ${pagos.length} registro(s) actualizados.`);
  return { actualizados: pagos.length };
}

// ============================================
// getInvestorMirrorSummary
// ============================================

/**
 * Calcula los subtotales financieros globales de un inversionista usando
 * EXCLUSIVAMENTE los registros de `pagos_credito_inversionistas_espejo`.
 *
 * Lógica:
 *  1. Lee `monto_aportado` base de `creditos_inversionistas_espejo`.
 *  2. Suma todos los `abono_capital` de los pagos espejo.
 *  3. Saldo actual = monto_aportado_base - SUM(abono_capital de pagos).
 *
 * La respuesta incluye únicamente datos básicos del inversionista y
 * subtotales globales (sin detalle de créditos ni de pagos individuales).
 *
 * @param investorId        - ID del inversionista (opcional si se provee dpi)
 * @param dpi               - DPI del inversionista (opcional si se provee investorId)
 * @param incluirLiquidados - Si true, incluye pagos ya liquidados en el cálculo
 */
export async function getInvestorMirrorSummary(
  investorId?: number,
  dpi?: string,
  incluirLiquidados = false
) {
  console.log(
    "[getInvestorMirrorSummary] investorId:", investorId,
    "DPI:", dpi,
    "incluirLiquidados:", incluirLiquidados
  );

  // ── PASO 1: Validar y obtener datos del inversionista ──────────────────────
  const queryConditions: SQL[] = [];
  if (investorId) queryConditions.push(eq(inversionistas.inversionista_id, investorId));
  if (dpi) {
    const dpiNumber = parseInt(dpi, 10);
    if (isNaN(dpiNumber)) throw new Error("DPI inválido: debe ser un número entero.");
    queryConditions.push(eq(inversionistas.dpi, dpiNumber));
  }
  if (queryConditions.length === 0) {
    throw new Error("Debe proporcionar al menos 'id' o 'dpi' del inversionista.");
  }

  const [inv] = await db
    .select({
      inversionista_id: inversionistas.inversionista_id,
      nombre:           inversionistas.nombre,
      emite_factura:    inversionistas.emite_factura,
      reinversion:      inversionistas.tipo_reinversion,
      monto_reinversion: inversionistas.monto_reinversion,
      banco_id:         inversionistas.banco_id,
      tipo_cuenta:      inversionistas.tipo_cuenta,
      numero_cuenta:    inversionistas.numero_cuenta,
      dpi:              inversionistas.dpi,
      moneda:           inversionistas.moneda,
    })
    .from(inversionistas)
    .where(and(...queryConditions))
    .limit(1);

  if (!inv) throw new Error("Inversionista no encontrado.");

  console.log(`[getInvestorMirrorSummary] Inversionista: ${inv.nombre} (ID: ${inv.inversionista_id})`);

  // ── PASO 2: Leer monto_aportado base de creditos_inversionistas_espejo ─────
  const creditosEspejo = await db
    .select({
      credito_id:          creditos_inversionistas_espejo.credito_id,
      monto_aportado_base: creditos_inversionistas_espejo.monto_aportado,
    })
    .from(creditos_inversionistas_espejo)
    .where(eq(creditos_inversionistas_espejo.inversionista_id, inv.inversionista_id));

  const totalMontoBase = creditosEspejo.reduce(
    (acc, c) => acc.plus(new Big(c.monto_aportado_base ?? 0)),
    new Big(0)
  );

  const formatValue = (val: string | number) => inv.moneda === "dolares" ? formatToUSD(val) : Number(val);

  // Caso sin créditos espejo: devolver ceros con monto base
  if (creditosEspejo.length === 0) {
    return {
      inversionista_id: inv.inversionista_id,
      nombre:           inv.nombre,
      emite_factura:    inv.emite_factura,
      reinversion:      inv.reinversion,
      banco_id:         inv.banco_id,
      tipo_cuenta:      inv.tipo_cuenta,
      numero_cuenta:    inv.numero_cuenta,
      dpi:              inv.dpi,
      moneda:           inv.moneda,
      currencySymbol:   inv.moneda === "dolares" ? "$" : "Q.",
      subtotal: {
        total_abono_capital:      0,
        total_abono_interes:      0,
        total_abono_iva:          0,
        total_isr:                0,
        total_cuota_sin_reinversion: 0,
        total_cuota_con_reinversion: 0,
        total_monto_aportado:     formatValue(totalMontoBase.toString()),
        totalAbonoGeneralInteres: 0,
        total_capital_creditos:   formatValue(totalMontoBase.toString()),
        total_capital_actual:     formatValue(totalMontoBase.toString()),
        total_reinversion_capital: 0,
        total_reinversion_interes: 0,
        total_reinversion:         0,
      },
    };
  }

  const creditosIds = creditosEspejo.map((c) => c.credito_id);
  console.log(`[getInvestorMirrorSummary] Créditos espejo: ${creditosIds.length}`);

  // ── PASO 3: Obtener todos los pagos espejo (fuente de verdad) ─────────────
  const pagosConditions: SQL[] = [
    eq(pagos_credito_inversionistas_espejo.inversionista_id, inv.inversionista_id),
    inArray(pagos_credito_inversionistas_espejo.credito_id, creditosIds),
  ];
  if (!incluirLiquidados) {
    pagosConditions.push(
      eq(pagos_credito_inversionistas_espejo.estado_liquidacion, "NO_LIQUIDADO")
    );
  }

  const pagosEspejo = await db
    .select({
      credito_id:    pagos_credito_inversionistas_espejo.credito_id,
      abono_capital: pagos_credito_inversionistas_espejo.abono_capital,
      abono_interes: pagos_credito_inversionistas_espejo.abono_interes,
      abono_iva_12:  pagos_credito_inversionistas_espejo.abono_iva_12,
    })
    .from(pagos_credito_inversionistas_espejo)
    .where(and(...pagosConditions));

  console.log(`[getInvestorMirrorSummary] Pagos espejo: ${pagosEspejo.length}`);

  // Agrupar pagos por credito_id
  const pagosPorCredito = new Map<number, typeof pagosEspejo>();
  for (const pago of pagosEspejo) {
    const arr = pagosPorCredito.get(pago.credito_id) ?? [];
    arr.push(pago);
    pagosPorCredito.set(pago.credito_id, arr);
  }

  // ── PASO 4: Calcular subtotales globales ──────────────────────────────────
  const sg = {
    total_abono_capital:      new Big(0),
    total_abono_interes:      new Big(0),
    total_abono_iva:          new Big(0),
    total_isr:                new Big(0),
    total_cuota:              new Big(0),
    total_monto_aportado:     new Big(0),
    totalAbonoGeneralInteres: new Big(0),
    total_capital_creditos:   new Big(0),
    total_capital_actual:     new Big(0),
    total_reinversion_capital: new Big(0),
    total_reinversion_interes: new Big(0),
    total_reinversion:         new Big(0),
  };

  for (const credito of creditosEspejo) {
    const pagos             = pagosPorCredito.get(credito.credito_id) ?? [];
    const montoAportadoBase = new Big(credito.monto_aportado_base ?? 0);

    sg.total_capital_creditos = sg.total_capital_creditos.plus(montoAportadoBase);

    let abonoCapitalCredito = new Big(0);

    for (const pago of pagos) {
      const abono_capital = new Big(pago.abono_capital ?? 0);
      const abono_interes = new Big(pago.abono_interes ?? 0);
      const abono_iva     = new Big(pago.abono_iva_12  ?? 0);

      // ISR: 7% sobre interés si NO emite factura
      const isr = inv.emite_factura
        ? new Big(0)
        : abono_interes.times(0.07).round(2);

      const abonoGeneralInteres = inv.emite_factura
        ? abono_interes.plus(abono_iva)
        : abono_interes.minus(isr);

      let cuota_inversor: Big;
      let reinvCapital = new Big(0);
      let reinvInteres = new Big(0);
      const interesTotal = abono_interes.plus(inv.emite_factura ? abono_iva : isr.neg());

      switch (inv.reinversion) {
        case "sin_reinversion":
          cuota_inversor = abono_capital.plus(interesTotal);
          break;
        case "reinversion_capital":
          reinvCapital = abono_capital;
          cuota_inversor = interesTotal;
          break;
        case "reinversion_interes":
          reinvInteres = abono_interes;
          cuota_inversor = abono_capital.plus(inv.emite_factura ? abono_iva : isr.neg());
          break;
        case "reinversion_total":
          reinvCapital = abono_capital;
          reinvInteres = abono_interes;
          cuota_inversor = new Big(0);
          break;
        case "reinversion_variable":
          // Se calcula como sin_reinversion per-pago; el tope global se aplica después
          cuota_inversor = abono_capital.plus(interesTotal);
          break;
        default:
          cuota_inversor = abono_capital.plus(interesTotal);
      }

      abonoCapitalCredito         = abonoCapitalCredito.plus(abono_capital);
      sg.total_abono_capital      = sg.total_abono_capital.plus(abono_capital);
      sg.total_abono_interes      = sg.total_abono_interes.plus(abono_interes);
      sg.total_abono_iva          = sg.total_abono_iva.plus(abono_iva);
      sg.total_isr                = sg.total_isr.plus(isr);
      sg.total_cuota              = sg.total_cuota.plus(cuota_inversor);
      sg.totalAbonoGeneralInteres = sg.totalAbonoGeneralInteres.plus(abonoGeneralInteres);
      sg.total_reinversion_capital = sg.total_reinversion_capital.plus(reinvCapital);
      sg.total_reinversion_interes = sg.total_reinversion_interes.plus(reinvInteres);
      sg.total_reinversion         = sg.total_reinversion.plus(reinvCapital).plus(reinvInteres);
    }

    // 🔑 Saldo actual = monto_aportado_base - SUM(abono_capital de pagos espejo)
    const capital_actual = montoAportadoBase.minus(abonoCapitalCredito);
    sg.total_monto_aportado = sg.total_monto_aportado.plus(capital_actual);
    sg.total_capital_actual = sg.total_capital_actual.plus(capital_actual);
  }

  // Aplicar reinversión variable como tope global sobre el total
  if (inv.reinversion === "reinversion_variable") {
    const montoReinv = new Big(inv.monto_reinversion ?? 0);
    const reinversion = montoReinv.gt(sg.total_cuota) ? sg.total_cuota : montoReinv;
    sg.total_reinversion = reinversion;
    sg.total_cuota = sg.total_cuota.minus(reinversion);
  }

  // ── PASO 5: Retornar datos del inversionista + subtotales globales ─────────
  return {
    inversionista_id: inv.inversionista_id,
    nombre:           inv.nombre,
    emite_factura:    inv.emite_factura,
    reinversion:      inv.reinversion,
    banco_id:         inv.banco_id,
    tipo_cuenta:      inv.tipo_cuenta,
    numero_cuenta:    inv.numero_cuenta,
    dpi:              inv.dpi,
    moneda:           inv.moneda,
    currencySymbol:   inv.moneda === "dolares" ? "$" : "Q.",
    subtotal: {
      total_abono_capital:      formatValue(sg.total_abono_capital.toString()),
      total_abono_interes:      formatValue(sg.total_abono_interes.toString()),
      total_abono_iva:          formatValue(sg.total_abono_iva.toString()),
      total_isr:                formatValue(sg.total_isr.toString()),
      total_cuota_sin_reinversion: formatValue(sg.total_cuota.plus(sg.total_reinversion).toString()),
      total_cuota_con_reinversion: formatValue(sg.total_cuota.toString()),
      total_monto_aportado:     formatValue(sg.total_monto_aportado.toString()),
      totalAbonoGeneralInteres: formatValue(sg.totalAbonoGeneralInteres.toString()),
      total_capital_creditos:   formatValue(sg.total_capital_creditos.toString()),
      total_capital_actual:     formatValue(sg.total_capital_actual.toString()),
      total_reinversion_capital: formatValue(sg.total_reinversion_capital.toString()),
      total_reinversion_interes: formatValue(sg.total_reinversion_interes.toString()),
      total_reinversion:         formatValue(sg.total_reinversion.toString()),
    },
  };
}

export const liquidateByInvestorSchema = z.object({
  inversionista_id: z.number().optional(), // 🆕 Ahora es opcional
});
export async function liquidateByInvestorId(inversionista_id?: number) {
  if (inversionista_id) {
    console.log(`Liquidando inversionista_id: ${inversionista_id}`);
  } else {
    console.log("⚠️ LIQUIDANDO TODOS LOS INVERSIONISTAS ⚠️");
  }

  // 🔍 PASO 1: Determinar qué inversionistas liquidar
  let inversionistasALiquidar: number[] = [];

  if (inversionista_id) {
    inversionistasALiquidar = [inversionista_id];
  } else {
    const inversionistasConPagos = await db
        .selectDistinct({
          inversionista_id: pagos_credito_inversionistas_espejo.inversionista_id,
        })
        .from(pagos_credito_inversionistas_espejo)
        .where(
          eq(pagos_credito_inversionistas_espejo.estado_liquidacion, "NO_LIQUIDADO")
        );

      inversionistasALiquidar = inversionistasConPagos.map(
        (i) => i.inversionista_id
      );
  }

  if (inversionistasALiquidar.length === 0) {
    const mensaje = inversionista_id
      ? `No se encontró ningún pago NO_LIQUIDADO para el inversionista_id: ${inversionista_id}`
      : "No se encontró ningún pago NO_LIQUIDADO en el sistema";
    throw new Error(`[ERROR] ${mensaje}`);
  }

  console.log(
    `📋 Se liquidarán ${inversionistasALiquidar.length} inversionista(s)`
  );

  // 📊 PASO 2: Procesar cada inversionista
  let totalPagosLiquidados = 0;
  let totalLiquidaciones = 0;
  let inversionistasSaltados = 0;
  const reportesGenerados: Array<{ 
    inversionista_id: number; 
    url: string;
    boleta_id: number;
    boleta_url: string;
  }> = [];
  const errores: Array<{
    inversionista_id: number;
    razon: string;
  }> = [];

  for (const inv_id of inversionistasALiquidar) {
    try {
      console.log(`\n💰 Procesando inversionista ${inv_id}...`);

      // ========================================
      // FASE 1: VALIDACIONES PRE-TRANSACCION
      // ========================================

      // Buscar boleta PENDIENTE del inversionista
      console.log(`  🔍 Buscando boleta PENDIENTE...`);
      const [boletaPendiente] = await db
        .select()
        .from(boletasPagoInversionista)
        .where(
          and(
            eq(boletasPagoInversionista.inversionista_id, inv_id),
            eq(boletasPagoInversionista.estado, "PENDIENTE")
          )
        )
        .orderBy(desc(boletasPagoInversionista.fecha_subida))
        .limit(1);

      if (boletaPendiente) {
        console.log(`  ✅ Boleta encontrada: ID ${boletaPendiente.boleta_id}`);
      } else {
        console.log(`  ⚠️ Sin boleta PENDIENTE, se liquida sin boleta`);
      }

      // Verificar que hay pagos NO_LIQUIDADO para este inversionista
      const pagosNoLiquidados = await db
        .select({
          id: pagos_credito_inversionistas_espejo.id,
          pago_id: pagos_credito_inversionistas_espejo.pago_id,
          credito_id: pagos_credito_inversionistas_espejo.credito_id,
          abono_capital: pagos_credito_inversionistas_espejo.abono_capital,
        })
        .from(pagos_credito_inversionistas_espejo)
        .where(
          and(
            eq(pagos_credito_inversionistas_espejo.inversionista_id, inv_id),
            eq(pagos_credito_inversionistas_espejo.estado_liquidacion, "NO_LIQUIDADO")
          )
        );

      if (pagosNoLiquidados.length === 0) {
        console.log(`  ⚠️ Inversionista ${inv_id} sin pagos para liquidar`);
        errores.push({ inversionista_id: inv_id, razon: "Sin pagos para liquidar" });
        inversionistasSaltados++;
        continue;
      }

      // Totales pre-liquidación (espejos, no liquidados)
      const totalesResult = await getInvestorTotalsGlobales(inv_id, undefined, "espejos", false);
      const totales = totalesResult.totales;
      const cantidadPagos = pagosNoLiquidados.length;

      console.log(`  📊 Total pagos a liquidar: ${cantidadPagos}`);

      const reinvCapital = totales.total_reinversion_capital ?? 0;
      const reinvInteres = totales.total_reinversion_interes ?? 0;
      const reinvTotal = totales.total_reinversion ?? 0;

      // ========================================
      // FASE 2: TRANSACCION (datos financieros)
      // ========================================

      // Crear registro de liquidación
      const [liquidacion] = await db
        .insert(liquidaciones)
        .values({
          inversionista_id: inv_id,
          boleta_id: boletaPendiente?.boleta_id ?? null,
          total_pagos_liquidados: cantidadPagos,
          total_capital: totales.total_abono_capital.toString(),
          total_interes: totales.total_abono_interes.toString(),
          total_iva: totales.total_abono_iva.toString(),
          total_isr: totales.total_isr.toString(),
          total_cuota: (totales.total_cuota_con_reinversion ?? 0).toString(),
          reinversion_capital: reinvCapital.toString(),
          reinversion_interes: reinvInteres.toString(),
          reinversion_total: reinvTotal.toString(),
          fecha_liquidacion: new Date(),
        })
        .returning();

      console.log(`  ✅ Liquidación creada: liquidacion_id=${liquidacion.liquidacion_id}`);

      // Marcar boleta como PROCESADO (solo si existe)
      if (boletaPendiente) {
        await db
          .update(boletasPagoInversionista)
          .set({ estado: "PROCESADO", fecha_procesado: new Date() })
          .where(eq(boletasPagoInversionista.boleta_id, boletaPendiente.boleta_id));
        console.log(`  ✅ Boleta ${boletaPendiente.boleta_id} marcada como PROCESADO`);
      }

      // Reinversiones
      const montoReinvertido = new Big(reinvTotal);
      if (montoReinvertido.gt(0)) {
        await db.update(inversionistas)
          .set({
            saldo_reinversion: sql`${inversionistas.saldo_reinversion} + ${montoReinvertido.toFixed(2)}::numeric`,
          })
          .where(eq(inversionistas.inversionista_id, inv_id));

        await db.update(reinversiones)
          .set({ monto_capital: "0", monto_interes: "0", monto_total: "0" })
          .where(eq(reinversiones.inversionista_id, inv_id));

        console.log(`  ✅ Saldo reinversión actualizado (+${montoReinvertido.toFixed(2)})`);
      }

      // Descontar capital por crédito y marcar pagos como LIQUIDADO
      const creditosConPagos = new Map<number, typeof pagosNoLiquidados>();
      for (const pago of pagosNoLiquidados) {
        if (!creditosConPagos.has(pago.credito_id)) {
          creditosConPagos.set(pago.credito_id, []);
        }
        creditosConPagos.get(pago.credito_id)!.push(pago);
      }

      const pagosIds = pagosNoLiquidados.map((p) => p.id);

      for (const [creditoId, pagosCred] of creditosConPagos) {
        const sumaCapital = pagosCred.reduce((sum, p) => sum + Number(p.abono_capital || 0), 0);
        if (sumaCapital > 0) {
          await processAndReplaceCreditInvestors(
            creditoId,
            new Big(sumaCapital).toNumber(),
            false,
            inv_id,
            true
          );
        }
      }

      let updateResult: any = { rowCount: 0 };
      if (pagosIds.length > 0) {
        updateResult = await db
          .update(pagos_credito_inversionistas_espejo)
          .set({
            estado_liquidacion: "LIQUIDADO",
            liquidacion_id: liquidacion.liquidacion_id,
          })
          .where(inArray(pagos_credito_inversionistas_espejo.id, pagosIds));
      }

      console.log(`  ✅ ${updateResult.rowCount ?? 0} pagos espejo actualizados`);

      // Marcar cuotas como liquidado_inversionistas
      const allPagoIds = [...new Set(pagosNoLiquidados.map((p) => p.pago_id))];
      if (allPagoIds.length > 0) {
        const cuotasDeLosPagos = await db
          .select({ cuota_id: pagos_credito.cuota_id })
          .from(pagos_credito)
          .where(inArray(pagos_credito.pago_id, allPagoIds));

        const uniqueCuotaIds = [...new Set(cuotasDeLosPagos.map((c) => c.cuota_id))];
        if (uniqueCuotaIds.length > 0) {
          const fechaGuatemala = new Date(
            new Date().toLocaleString("en-US", { timeZone: "America/Guatemala" })
          );
          await db
            .update(cuotas_credito)
            .set({
              liquidado_inversionistas: false,
              fecha_liquidacion_inversionistas: fechaGuatemala,
            })
            .where(inArray(cuotas_credito.cuota_id, uniqueCuotaIds));
          console.log(`  ✅ ${uniqueCuotaIds.length} cuotas actualizadas`);
        }
      }

      // ========================================
      // FASE 3: POST-TRANSACCION (PDF + email, best-effort)
      // Los datos financieros ya están committed
      // ========================================
      try {
        const resumen = await resumeInvestor(
          inv_id,
          1,
          999999,
          undefined,
          undefined,
          undefined,
          true,
          undefined,
          "espejos",
          true,
          liquidacion.liquidacion_id
        );

        const inversionista = resumen.inversionistas?.[0];

        if (inversionista) {
          inversionista.subtotal = totales as any;

          console.log(`  📄 Generando PDF...`);
          const logoUrl = process.env.LOGO_URL || "";
          const filename = `liquidacion_${liquidacion.liquidacion_id}_${Date.now()}.pdf`;
          const pdfResult = await generarYSubirPDFInversionista(
            inversionista as any,
            filename,
            logoUrl
          );
          const url = pdfResult.url;
          const pdfBuffer = Buffer.from(pdfResult.pdfBuffer);

          console.log(`  ✅ PDF generado: ${filename}`);

          // Actualizar liquidación con URL del reporte
          await db
            .update(liquidaciones)
            .set({ reporte_liquidacion_url: url })
            .where(eq(liquidaciones.liquidacion_id, liquidacion.liquidacion_id));

          // Enviar correo (best-effort)
          if (inversionista.email && pdfBuffer) {
            try {
              await sendLiquidationEmail({
                to: inversionista.email,
                investorName: inversionista.nombre_inversionista,
                amount: inversionista.subtotal.total_cuota.toString(),
                creditNumber: "Múltiples",
                date: dayjs().format("DD/MM/YYYY"),
                currencySymbol: inversionista.moneda === "dolares" ? "$" : "Q.",
                attachment: {
                  filename: `Liquidacion_${inversionista.nombre_inversionista.replace(/\s+/g, '_')}_${dayjs().format('YYYYMMDD')}.pdf`,
                  content: pdfBuffer,
                }
              });
              console.log(`  📧 Correo enviado a ${inversionista.email}`);
            } catch (emailError) {
              console.error(`  ❌ Error al enviar correo a ${inversionista.email}:`, emailError);
            }
          } else {
            console.warn(`  ⚠️ Inversionista sin correo configurado`);
          }

          reportesGenerados.push({
            inversionista_id: inv_id,
            url,
            boleta_id: boletaPendiente?.boleta_id ?? 0,
            boleta_url: boletaPendiente?.boleta_url ?? "",
          });
        }
      } catch (pdfError) {
        console.error(`  ❌ Error generando PDF (datos financieros ya guardados):`, pdfError);
      }

      totalPagosLiquidados += updateResult.rowCount ?? 0;
      totalLiquidaciones++;
    } catch (error) {
      console.error(`  ❌ Error procesando inversionista ${inv_id}:`, error);
      errores.push({
        inversionista_id: inv_id,
        razon: error instanceof Error ? error.message : "Error desconocido",
      });
      inversionistasSaltados++;
    }
  }

  // 📝 PASO 8: Mensaje final
  const mensaje = inversionista_id
    ? totalLiquidaciones > 0 
      ? `Inversionista ${inversionista_id} liquidado correctamente`
      : `No se pudo liquidar al inversionista ${inversionista_id}`
    : `${totalLiquidaciones} inversionistas liquidados correctamente (${inversionistasSaltados} saltados)`;

  console.log(`\n✅ RESUMEN FINAL:`);
  console.log(`   - Liquidaciones creadas: ${totalLiquidaciones}`);
  console.log(`   - Pagos liquidados: ${totalPagosLiquidados}`);
  console.log(`   - PDFs generados: ${reportesGenerados.length}`);
  console.log(`   - Boletas procesadas: ${reportesGenerados.length}`);
  console.log(`   - Inversionistas saltados: ${inversionistasSaltados}`);
  
  if (errores.length > 0) {
    console.log(`\n⚠️ INVERSIONISTAS NO PROCESADOS:`);
    errores.forEach(e => {
      console.log(`   - ID ${e.inversionista_id}: ${e.razon}`);
    });
  }

  return {
    message: mensaje,
    updatedCount: totalPagosLiquidados,
    inversionista_id: inversionista_id ?? "TODOS",
    liquidaciones_creadas: totalLiquidaciones,
    inversionistas_saltados: inversionistasSaltados,
    reportes: reportesGenerados,
    errores: errores.length > 0 ? errores : undefined,
  };
}
import dayjs from "dayjs";
import "dayjs/locale/es";
import { InversionistaReporte } from "../utils/interface";

import ExcelJS from "exceljs";

dayjs.locale("es");

export function generarHTMLReporte(
  inversionista: InversionistaReporte,
  logoUrl: string = import.meta.env.LOGO_URL || ""
): string {
  const {
    nombre_inversionista: nombre_inversionista,
    emite_factura,
    creditos: creditosData,
    subtotal,
  } = inversionista;
  const fechaHoy = dayjs().format("DD [de] MMMM YYYY");

  // Moneda dinámica
  const esDolares = inversionista.moneda === "dolares";
  const sym = esDolares ? "$" : "Q";
  const currCode = esDolares ? "USD" : "GTQ";
  const locale = esDolares ? "en-US" : "es-GT";

  const fmt = (val: number | string | null | undefined) => {
    const n = Number(val || 0);
    return `${sym}${n.toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  // Totales formateados
  const capitalActivo = fmt(
    creditosData.reduce((s, c) => s + parseFloat(c.monto_aportado || "0"), 0)
  );
  const abonoCapital = subtotal.total_abono_capital
    ? fmt(subtotal.total_abono_capital)
    : "";

  const abonoInteres = subtotal.total_abono_interes
    ? fmt(subtotal.total_abono_interes)
    : "";

  const granTotal = subtotal.total_cuota_con_reinversion
    ? fmt(subtotal.total_cuota_con_reinversion)
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
      margin-top: -50px;
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
        <div class="header-company-name">${nombre_inversionista}</div>
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
            <th>% Interés</th>
            <th>% Inversionista</th>
            <th>Tasa interés inversor</th>
            <th>Interés Inversor</th>
            <th>IVA</th>
            <th>ISR</th>
            <th>Abono capital</th>
            <th>% Inversionista Neto</th>
            <th>Capital restante</th>
            <th>Cuota de mes</th>
            <th>Plazo</th>
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
                                  <td>${pago.cuota ?? c.meses_en_credito ?? ""}</td>
                                  <td>${c.nombre_usuario ?? ""}</td>
                          <td>
                  ${fmt(Big(c.monto_aportado || 0).add(Big(pago.abono_capital || 0)).toFixed(2))}
                </td>
                                  <td>${c.porcentaje_interes ?? ""} %</td>
                                  <td>${pago.porcentaje_inversor ?? ""} %</td>
                  <td>${Big(pago.tasaInteresInvesor || 0).div(100).toFixed(2)} %</td>
                  <td>${fmt(pago.abono_interes)}</td>
                  <td>${fmt(pago.abono_iva)}</td>
                  <td>${fmt(pago.isr)}</td>
                  <td>${fmt(pago.abono_capital)}</td>
                  <td>${fmt(pago.abonoGeneralInteres)}</td>
                              <td>
                  ${fmt(c.monto_aportado)}
                </td>
        <td>${pago.mes || "-"}${pago.cuota ? ` (Cuota #${pago.cuota})` : ""}</td>
                  <td>${c.plazo ?? ""}</td>
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
            <td>${fmt(Number(subtotal.total_monto_aportado || 0) + Number(subtotal.total_abono_capital || 0))}</td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td></td>
            <td>${subtotal.total_abono_capital ? fmt(subtotal.total_abono_capital) : ""}</td>
            <td>${subtotal.total_abono_general_interes ? fmt(subtotal.total_abono_general_interes) : ""}</td>
            <td>${subtotal.total_monto_aportado ? fmt(subtotal.total_monto_aportado) : ""}</td>
            <td></td>
            <td></td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
    <div style="display:flex;gap:80px;margin:28px 50px 0 50px;">
      <div style="text-align:center;min-width:220px;">
        <div style="font-size:2.2rem;font-weight:bold;color:#1d293b;">
          ${fmt(subtotal.total_reinversion_capital)}
        </div>
        <div style="color:#8c98b5;font-size:1.15rem;margin-top:4px;">Reinversión Capital</div>
      </div>
      <div style="text-align:center;min-width:220px;">
        <div style="font-size:2.2rem;font-weight:bold;color:#1d293b;">
          ${fmt(subtotal.total_reinversion_interes)}
        </div>
        <div style="color:#8c98b5;font-size:1.15rem;margin-top:4px;">Reinversión Interés</div>
      </div>
      <div style="text-align:center;min-width:220px;">
        <div style="font-size:2.2rem;font-weight:bold;color:#215da8;">
          ${fmt(subtotal.total_reinversion)}
        </div>
        <div style="color:#8c98b5;font-size:1.15rem;margin-top:4px;">Total Reinversión</div>
      </div>
    </div>
    <div class="footer">
      Generado por Club Cashin.com · ${fechaHoy}
    </div>
  </div>
</body>
</html>
`;
}

export const findOrCreateInvestor = async (
  nombre: string,
  emite_factura: boolean = true
) => {
  console.log(`🔍 Buscando/creando inversionista: "${nombre}"`);
  
  // 🧹 NORMALIZAR nombre
  const nombreNormalizado = nombre.trim();
  const nombreLower = nombreNormalizado.toLowerCase();
  
  // 1️⃣ BÚSQUEDA EXACTA (case insensitive)
  console.log(`   🎯 Estrategia 1: Búsqueda exacta...`);
  const exactMatch = await db
    .select()
    .from(inversionistas)
    .where(sql`LOWER(TRIM(${inversionistas.nombre})) = ${nombreLower}`)
    .limit(1);

  if (exactMatch.length > 0) {
    console.log(`   ✅ Inversionista encontrado (exacto): ${exactMatch[0].nombre} (ID: ${exactMatch[0].inversionista_id})`);
    return exactMatch[0];
  }

  // 2️⃣ BÚSQUEDA SIN TILDES
  console.log(`   🎯 Estrategia 2: Búsqueda sin tildes...`);
  const nombreSinTildes = nombreNormalizado
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  
  const withoutAccents = await db
    .select()
    .from(inversionistas)
    .where(
      sql`LOWER(
        TRIM(
          translate(
            ${inversionistas.nombre}, 
            'áéíóúÁÉÍÓÚñÑ', 
            'aeiouAEIOUnN'
          )
        )
      ) = ${nombreSinTildes}`
    )
    .limit(1);

  if (withoutAccents.length > 0) {
    console.log(`   ✅ Inversionista encontrado (sin tildes): ${withoutAccents[0].nombre} (ID: ${withoutAccents[0].inversionista_id})`);
    return withoutAccents[0];
  }

  // 3️⃣ BÚSQUEDA "COMIENZA CON" - Para nombres con apellidos extras
  console.log(`   🎯 Estrategia 3: Búsqueda "comienza con"...`);
  
  // 🔥 BUSCAR SI ALGÚN NOMBRE EN BD ESTÁ CONTENIDO EN EL NOMBRE DEL EXCEL
  // Ejemplo: Si en BD hay "Ana Lucia Salvatierra" y en Excel "Ana Lucia Salvatierra Mayen"
  //          debería encontrar el de BD porque "Ana Lucia Salvatierra" está contenido
  
  const allInvestors = await db
    .select()
    .from(inversionistas);
  
  // Buscar si el nombre del Excel COMIENZA con algún nombre de BD
  const startsWithMatch = allInvestors.find(inv => {
    const invNombreLower = inv.nombre.toLowerCase().trim();
    const nombreLowerTrim = nombreLower.trim();
    
    // Si el nombre de BD está contenido al inicio del nombre del Excel
    return nombreLowerTrim.startsWith(invNombreLower) && nombreLowerTrim.length > invNombreLower.length;
  });

  if (startsWithMatch) {
    console.log(`   ✅ Inversionista encontrado (nombre base): ${startsWithMatch.nombre} (ID: ${startsWithMatch.inversionista_id})`);
    console.log(`   ℹ️  "${nombreNormalizado}" coincide con "${startsWithMatch.nombre}"`);
    return startsWithMatch;
  }

  // 4️⃣ BÚSQUEDA INVERSA - Si en BD hay un nombre más largo
  console.log(`   🎯 Estrategia 4: Búsqueda inversa (nombre más largo en BD)...`);
  
  const containsMatch = allInvestors.find(inv => {
    const invNombreLower = inv.nombre.toLowerCase().trim();
    const nombreLowerTrim = nombreLower.trim();
    
    // Si el nombre del Excel está contenido al inicio del nombre de BD
    return invNombreLower.startsWith(nombreLowerTrim) && invNombreLower.length > nombreLowerTrim.length;
  });

  if (containsMatch) {
    console.log(`   ✅ Inversionista encontrado (nombre completo en BD): ${containsMatch.nombre} (ID: ${containsMatch.inversionista_id})`);
    console.log(`   ℹ️  "${nombreNormalizado}" es parte de "${containsMatch.nombre}"`);
    return containsMatch;
  }

  // 5️⃣ BÚSQUEDA POR PALABRAS CLAVE (más restrictiva)
  console.log(`   🎯 Estrategia 5: Búsqueda por palabras clave...`);
  
  // Dividir en palabras (ignorar palabras muy cortas como "de", "la", etc.)
  const palabras = nombreNormalizado
    .split(/\s+/)
    .filter(p => p.length > 2 && !['del', 'de', 'la', 'los', 'las'].includes(p.toLowerCase()));
  
  if (palabras.length >= 2) { // Solo si tiene al menos 2 palabras significativas
    // Buscar inversionistas que tengan TODAS las palabras importantes
    const wordMatches = allInvestors.filter(inv => {
      const invWords = inv.nombre.toLowerCase().split(/\s+/);
      // Verificar que TODAS las palabras del Excel estén en el nombre de BD
      return palabras.every(palabra => 
        invWords.some(w => w.includes(palabra.toLowerCase()))
      );
    });

    if (wordMatches.length === 1) {
      console.log(`   ✅ Inversionista encontrado (por palabras): ${wordMatches[0].nombre} (ID: ${wordMatches[0].inversionista_id})`);
      return wordMatches[0];
    } else if (wordMatches.length > 1) {
      console.log(`   ⚠️ Múltiples matches (${wordMatches.length}):`);
      wordMatches.forEach((inv, idx) => {
        console.log(`      ${idx + 1}. ${inv.nombre} (ID: ${inv.inversionista_id})`);
      });
      
      // 🔥 Usar el que tenga el nombre más corto (más probable que sea el base)
      const shortest = wordMatches.reduce((prev, curr) => 
        prev.nombre.length < curr.nombre.length ? prev : curr
      );
      
      console.log(`   ✅ Usando el más corto: ${shortest.nombre} (ID: ${shortest.inversionista_id})`);
      return shortest;
    }
  }

  // 6️⃣ NO EXISTE → CREAR NUEVO
  console.log(`   ➕ Inversionista no encontrado, creando nuevo...`);
  
  const [newInvestor] = await db
    .insert(inversionistas)
    .values({
      nombre: nombreNormalizado,
      emite_factura,
      banco_id: null,
      tipo_cuenta: null,
      numero_cuenta: null,
    })
    .returning();

  console.log(`   ✅ Inversionista creado: ${newInvestor.nombre} (ID: ${newInvestor.inversionista_id})`);
  return newInvestor;
};
export const updateInvestor = async ({ body, set }: any) => {
  try {
    // Permitir un solo objeto o un arreglo
    let inversionistasToUpdate = [];
    if (Array.isArray(body)) {
      inversionistasToUpdate = body;
    } else if (typeof body === "object") {
      inversionistasToUpdate = [body];
    }

    // Validación mínima: debe traer inversionista_id
    const isValid = inversionistasToUpdate.every(
      (inv) => typeof inv.inversionista_id !== "undefined"
    );
    if (!isValid || inversionistasToUpdate.length === 0) {
      set.status = 400;
      return {
        message:
          "Cada inversionista debe incluir inversionista_id para actualizar.",
      };
    }

    const updatedResults = [];
    for (const inv of inversionistasToUpdate) {
      const {
        inversionista_id,
        nombre,
        emite_factura,
        tipo_reinversion, // ⭐ Agregado
        monto_reinversion,
        permite_distribucion,
        banco,
        tipo_cuenta,
        numero_cuenta,
        dpi,
        moneda,
      } = inv;

      // Construir dinámicamente solo los campos enviados
      const updateData: any = {};
      if (typeof nombre !== "undefined") updateData.nombre = nombre;
      if (typeof emite_factura !== "undefined")
        updateData.emite_factura = emite_factura;
      if (typeof tipo_reinversion !== "undefined")
        updateData.tipo_reinversion = tipo_reinversion;
      if (typeof monto_reinversion !== "undefined")
        updateData.monto_reinversion = monto_reinversion;
      if (typeof permite_distribucion !== "undefined")
        updateData.permite_distribucion = permite_distribucion;
      if (typeof banco !== "undefined") updateData.banco = banco;
      if (typeof tipo_cuenta !== "undefined")
        updateData.tipo_cuenta = tipo_cuenta;
      if (typeof numero_cuenta !== "undefined")
        updateData.numero_cuenta = numero_cuenta;
      if (typeof dpi !== "undefined") updateData.dpi = dpi;
      if (typeof moneda !== "undefined") updateData.moneda = moneda;

      // Si no hay nada que actualizar, saltar
      if (Object.keys(updateData).length === 0) continue;
      console.log(
        "Actualizando inversionista_id:",
        inversionista_id,
        updateData
      );
      const [updated] = await db
        .update(inversionistas)
        .set(updateData)
        .where(eq(inversionistas.inversionista_id, inversionista_id))
        .returning();

      updatedResults.push(updated);
    }
    console.log("Inversionistas actualizados:", updatedResults.length);
    set.status = 200;
    return updatedResults;
  } catch (error) {
    set.status = 500;
    return { message: "Error updating investors", error: String(error) };
  }
};
interface BoletaPendiente {
  boleta_id: number;
  boleta_url: string;
  estado: string;
  notas: string | null;
  monto_boleta: string | null;
  fecha_subida: Date;
}

interface InversionistaResumen {
  inversionista_id: number;
  nombre: string;
  emite_factura: boolean;
  reinversion:
    | "sin_reinversion"
    | "reinversion_capital"
    | "reinversion_interes"
    | "reinversion_total"
    | "reinversion_variable";
  banco: string | null;
  tipo_cuenta: string | null;
  numero_cuenta: string | null;
  total_abono_capital: number;
  total_abono_interes: number;
  total_abono_iva: number;
  total_isr: number;
  total_a_recibir_sin_reinversion: number;
  total_reinversion: number;
  total_a_recibir_con_reinversion: number;
  boleta_pendiente: BoletaPendiente | null;
}

export async function resumenGlobalInversionistas(
  inversionistaId?: number,
  mes?: number,
  anio?: number,
  excel: boolean = false
): Promise<
  InversionistaResumen[] | { success: boolean; url: string; filename: string }
> {
  // 🔎 Condiciones sobre inversionistas (van en WHERE)
  const condicionesWhere: any[] = [
    eq(inversionistas.permite_distribucion, false) // Solo inversionistas que NO permiten distribución (es decir, que se les paga directamente)
  ];

  if (inversionistaId) {
    condicionesWhere.push(
      eq(inversionistas.inversionista_id, inversionistaId)
    );
  }

  // 🔎 Condiciones sobre pagos espejo (van en el ON del LEFT JOIN)
  const pe = pagos_credito_inversionistas_espejo; // alias corto

  const condicionesJoinPagos: any[] = [
    eq(inversionistas.inversionista_id, pe.inversionista_id),
    eq(pe.estado_liquidacion, "NO_LIQUIDADO"),
  ];

  if (mes) {
    condicionesJoinPagos.push(
      sql`EXTRACT(MONTH FROM ${pe.fecha_pago}) = ${mes}`
    );
  }

  if (anio) {
    condicionesJoinPagos.push(
      sql`EXTRACT(YEAR FROM ${pe.fecha_pago}) = ${anio}`
    );
  }

  // 📊 Query agregada usando tablas ESPEJO (misma lógica que getInvestorMirrorSummary)

  const result = await db
    .select({
      inversionista_id: inversionistas.inversionista_id,
      nombre: inversionistas.nombre,
      emite_factura: inversionistas.emite_factura,
      reinversion: inversionistas.tipo_reinversion,
      banco_id: inversionistas.banco_id,
      banco_nombre: bancos.nombre,
      tipo_cuenta: inversionistas.tipo_cuenta,
      numero_cuenta: inversionistas.numero_cuenta,

      // Sumas directas de pagos espejo
      total_abono_capital: sql<number>`COALESCE(SUM(${pe.abono_capital}), 0)`,
      total_abono_interes: sql<number>`COALESCE(SUM(${pe.abono_interes}), 0)`,
      total_abono_iva: sql<number>`COALESCE(SUM(${pe.abono_iva_12}), 0)`,

      // ISR: 7% sobre interés si NO emite factura
      total_isr: sql<number>`COALESCE(SUM(
        CASE 
          WHEN ${inversionistas.emite_factura} THEN 0 
          ELSE ${pe.abono_interes} * 0.07
        END
      ), 0)`,

      // Total a recibir sin reinversión = abono_capital + interesTotal
      // interesTotal = abono_interes + (emite_factura ? iva : -(interes*0.07))
      total_a_recibir_sin_reinversion: sql<number>`COALESCE(SUM(
        ${pe.abono_capital}
        + ${pe.abono_interes}
        + CASE
            WHEN ${inversionistas.emite_factura}
              THEN ${pe.abono_iva_12}
            ELSE -(${pe.abono_interes} * 0.07)
          END
      ), 0)`,

      // Reinversión por tipo — CASE fuera de SUM para que reinversion_variable sea tope global
      total_reinversion: sql<number>`CASE ${inversionistas.tipo_reinversion}
        WHEN 'sin_reinversion' THEN 0
        WHEN 'reinversion_capital' THEN COALESCE(SUM(${pe.abono_capital}), 0)
        WHEN 'reinversion_interes' THEN COALESCE(SUM(${pe.abono_interes}), 0)
        WHEN 'reinversion_total' THEN COALESCE(SUM(${pe.abono_capital} + ${pe.abono_interes}), 0)
        WHEN 'reinversion_variable' THEN LEAST(
          COALESCE(${inversionistas.monto_reinversion}, 0)::numeric,
          COALESCE(SUM(
            ${pe.abono_capital}
            + ${pe.abono_interes}
            + CASE
                WHEN ${inversionistas.emite_factura}
                  THEN ${pe.abono_iva_12}
                ELSE -(${pe.abono_interes} * 0.07)
              END
          ), 0)
        )
        ELSE 0
      END`,

      // Total a recibir con reinversión = sin_reinversion - reinversion
      total_a_recibir_con_reinversion: sql<number>`
        COALESCE(SUM(
          ${pe.abono_capital}
          + ${pe.abono_interes}
          + CASE
              WHEN ${inversionistas.emite_factura}
                THEN ${pe.abono_iva_12}
              ELSE -(${pe.abono_interes} * 0.07)
            END
        ), 0)
        - CASE ${inversionistas.tipo_reinversion}
            WHEN 'sin_reinversion' THEN 0
            WHEN 'reinversion_capital' THEN COALESCE(SUM(${pe.abono_capital}), 0)
            WHEN 'reinversion_interes' THEN COALESCE(SUM(${pe.abono_interes}), 0)
            WHEN 'reinversion_total' THEN COALESCE(SUM(${pe.abono_capital} + ${pe.abono_interes}), 0)
            WHEN 'reinversion_variable' THEN LEAST(
              COALESCE(${inversionistas.monto_reinversion}, 0)::numeric,
              COALESCE(SUM(
                ${pe.abono_capital}
                + ${pe.abono_interes}
                + CASE
                    WHEN ${inversionistas.emite_factura}
                      THEN ${pe.abono_iva_12}
                    ELSE -(${pe.abono_interes} * 0.07)
                  END
              ), 0)
            )
            ELSE 0
          END`,
    })
    .from(inversionistas)
    .leftJoin(
      bancos,
      eq(inversionistas.banco_id, bancos.banco_id)
    )
    .leftJoin(
      pe,
      and(...condicionesJoinPagos)
    )
    .where(and(...condicionesWhere))
    .groupBy(
      inversionistas.inversionista_id,
      inversionistas.nombre,
      inversionistas.emite_factura,
      inversionistas.tipo_reinversion,
      inversionistas.monto_reinversion,
      inversionistas.banco_id,
      bancos.nombre,
      inversionistas.tipo_cuenta,
      inversionistas.numero_cuenta
    )
    // Solo mostrar inversionistas que tengan al menos 1 pago espejo NO_LIQUIDADO
     .having(
      excel
        ? undefined
        : sql`COUNT(${pe.id}) > 0`
    );

  console.log("resumen-global result IDs:", result.map(r => r.inversionista_id));
  console.log("resumen-global total:", result.length, "inversionistas");

  // 📂 Si excel = true → generar archivo, subir a R2 y devolver URL
  if (excel) {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Resumen Inversionistas");

    // 🎨 Estilo del encabezado
    const headerRow = sheet.addRow([
      "ID",
      "Nombre",
      "Factura",
      "Reinversión",
      "Banco",
      "Tipo Cuenta",
      "Número Cuenta",
      "Capital",
      "Interés",
      "IVA",
      "ISR",
      "Total sin Reinversión",
      "Reinversión",
      "Total con Reinversión",
    ]);

    // Estilizar encabezados
    headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
    headerRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF0070C0" },
    };
    headerRow.alignment = { horizontal: "center", vertical: "middle" };

    // Filas de datos
    result.forEach((inv) => {
      const row = sheet.addRow([
        inv.inversionista_id,
        inv.nombre,
        inv.emite_factura ? "Sí" : "No",
        inv.reinversion || "sin_reinversion",
        inv.banco_nombre ?? "", // 🔥 Ahora usamos banco_nombre
        inv.tipo_cuenta ?? "",
        inv.numero_cuenta ?? "",
        Number(inv.total_abono_capital).toFixed(2),
        Number(inv.total_abono_interes).toFixed(2),
        Number(inv.total_abono_iva).toFixed(2),
        Number(inv.total_isr).toFixed(2),
        Number(inv.total_a_recibir_sin_reinversion).toFixed(2),
        Number(inv.total_reinversion).toFixed(2),
        Number(inv.total_a_recibir_con_reinversion).toFixed(2),
      ]);

      // 🆕 Resaltar ISR = 0 cuando emite factura
      if (inv.emite_factura) {
        const isrCell = row.getCell(11); // Columna ISR
        isrCell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFE0E0E0" }, // Gris claro
        };
        isrCell.font = { color: { argb: "FF808080" } }; // Texto gris
      }

      // 🆕 Formato de moneda para columnas numéricas
      for (let i = 8; i <= 14; i++) {
        row.getCell(i).numFmt = "Q#,##0.00";
      }
    });

    // Ajustar ancho automático
    sheet.columns.forEach((col, index) => {
      let maxLength = 10;
      col.eachCell?.({ includeEmpty: true }, (cell) => {
        const len = cell.value ? cell.value.toString().length : 0;
        if (len > maxLength) maxLength = len;
      });
      col.width = maxLength + 2;
    });

    // Congelar primera fila (encabezados)
    sheet.views = [{ state: "frozen", ySplit: 1 }];

    const buffer = await workbook.xlsx.writeBuffer();

    // 🚀 Subir directo a R2
    const filename = `resumen_inversionistas_${Date.now()}.xlsx`;
    const s3 = new S3Client({
      endpoint: process.env.BUCKET_REPORTS_URL,
      region: "auto",
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID as string,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY as string,
      },
    });

    await s3.send(
      new PutObjectCommand({
        Bucket: process.env.BUCKET_REPORTS,
        Key: filename,
        Body: new Uint8Array(buffer),
        ContentType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
    );

    const url = `${process.env.URL_PUBLIC_R2_REPORTS}/${filename}`;

    return {
      success: true,
      url,
      filename,
    };
  }

  // 🔎 Obtener boletas pendientes por inversionista (solo para consulta JSON)
  const inversionistaIds = result.map((inv) => inv.inversionista_id);

  const boletasPendientes = inversionistaIds.length > 0
    ? await db
        .select({
          boleta_id: boletasPagoInversionista.boleta_id,
          inversionista_id: boletasPagoInversionista.inversionista_id,
          boleta_url: boletasPagoInversionista.boleta_url,
          estado: boletasPagoInversionista.estado,
          notas: boletasPagoInversionista.notas,
          monto_boleta: boletasPagoInversionista.monto_boleta,
          fecha_subida: boletasPagoInversionista.fecha_subida,
        })
        .from(boletasPagoInversionista)
        .where(
          and(
            inArray(boletasPagoInversionista.inversionista_id, inversionistaIds),
            eq(boletasPagoInversionista.estado, "PENDIENTE")
          )
        )
        .orderBy(desc(boletasPagoInversionista.fecha_subida))
    : [];

  // Mapear boleta pendiente por inversionista (solo la más reciente)
  const boletaMap = new Map<number, BoletaPendiente>();
  for (const b of boletasPendientes) {
    if (!boletaMap.has(b.inversionista_id)) {
      boletaMap.set(b.inversionista_id, {
        boleta_id: b.boleta_id,
        boleta_url: b.boleta_url,
        estado: b.estado,
        notas: b.notas,
        monto_boleta: b.monto_boleta,
        fecha_subida: b.fecha_subida,
      });
    }
  }

  // Map result to match InversionistaResumen interface
  return result.map((inv) => ({
    inversionista_id: inv.inversionista_id,
    nombre: inv.nombre,
    emite_factura: inv.emite_factura,
    reinversion: inv.reinversion,
    banco: inv.banco_nombre,
    tipo_cuenta: inv.tipo_cuenta,
    numero_cuenta: inv.numero_cuenta,
    total_abono_capital: inv.total_abono_capital,
    total_abono_interes: inv.total_abono_interes,
    total_abono_iva: inv.total_abono_iva,
    total_isr: inv.total_isr,
    total_a_recibir_sin_reinversion: inv.total_a_recibir_sin_reinversion,
    total_reinversion: inv.total_reinversion,
    total_a_recibir_con_reinversion: inv.total_a_recibir_con_reinversion,
    boleta_pendiente: boletaMap.get(inv.inversionista_id) ?? null,
  }));
}
/**
 * Obtiene liquidaciones con sus pagos
 * @param inversionista_id - Filtrar por inversionista (opcional)
 * @param liquidacion_id - Filtrar por liquidación específica (opcional)
 * @param dpi - Filtrar por DPI del inversionista (opcional)
 * @param page - Número de página
 * @param perPage - Registros por página
 */
export async function getLiquidaciones({
  inversionista_id,
  liquidacion_id,
  dpi,
  email,
  page = 1,
  perPage = 10,
}: {
  inversionista_id?: number;
  liquidacion_id?: number;
  dpi?: string;
  email?: string;
  page?: number;
  perPage?: number;
}) {
  console.log("[getLiquidaciones] Params:", {
    inversionista_id,
    liquidacion_id,
    dpi,
    page,
    perPage,
  });

  // 🔍 Construir condiciones
  const conditions = [];

  if (inversionista_id) {
    conditions.push(eq(liquidaciones.inversionista_id, inversionista_id));
  }

  if (liquidacion_id) {
    conditions.push(eq(liquidaciones.liquidacion_id, liquidacion_id));
  }

  // 🆕 Filtro por DPI
  if (dpi) {
    conditions.push(eq(inversionistas.dpi, parseInt(dpi)));
  }
  if (email) {
    conditions.push(eq(inversionistas.email, email));
  }

  // 📊 Query principal con joins
  const query = db
    .select({
      // Datos de liquidación
      liquidacion_id: liquidaciones.liquidacion_id,
      inversionista_id: liquidaciones.inversionista_id,
      boleta_id: liquidaciones.boleta_id, // 🔥 NUEVO
      total_pagos_liquidados: liquidaciones.total_pagos_liquidados,
      total_capital: liquidaciones.total_capital,
      total_interes: liquidaciones.total_interes,
      total_iva: liquidaciones.total_iva,
      total_isr: liquidaciones.total_isr,
      total_cuota: liquidaciones.total_cuota,
      reinversion_capital: liquidaciones.reinversion_capital,
      reinversion_interes: liquidaciones.reinversion_interes,
      reinversion_total: liquidaciones.reinversion_total,
      reporte_liquidacion: liquidaciones.reporte_liquidacion_url,
      fecha_liquidacion: liquidaciones.fecha_liquidacion,
      // Datos del inversionista
      nombre_inversionista: inversionistas.nombre,
      emite_factura: inversionistas.emite_factura,
      dpi: inversionistas.dpi,
      email: inversionistas.email,
    })
    .from(liquidaciones)
    .leftJoin(
      inversionistas,
      eq(liquidaciones.inversionista_id, inversionistas.inversionista_id)
    )
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(liquidaciones.fecha_liquidacion));

  // 🔢 Contar total de registros
  const totalQuery = db
    .select({ count: count() })
    .from(liquidaciones)
    .leftJoin(
      inversionistas,
      eq(liquidaciones.inversionista_id, inversionistas.inversionista_id)
    )
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const [{ count: totalItems }] = await totalQuery;
  const totalPages = Math.ceil(totalItems / perPage);

  // 📄 Paginación
  const liquidacionesData = await query
    .limit(perPage)
    .offset((page - 1) * perPage);

  // 💰 Para cada liquidación, traer sus pagos Y boleta
  const liquidacionesConPagos = await Promise.all(
    liquidacionesData.map(async (liq) => {
      // 📄 Traer boleta asociada a esta liquidación (si existe)
      let boletaData = null;
      
      if (liq.boleta_id) {
        console.log(`🔍 Buscando boleta ID: ${liq.boleta_id} para liquidación ${liq.liquidacion_id}`);
        
        const [boleta] = await db
          .select({
            boleta_id: boletasPagoInversionista.boleta_id,
            inversionista_id: boletasPagoInversionista.inversionista_id,
            boleta_url: boletasPagoInversionista.boleta_url,
            estado: boletasPagoInversionista.estado,
            monto_boleta: boletasPagoInversionista.monto_boleta,
            notas: boletasPagoInversionista.notas,
            fecha_subida: boletasPagoInversionista.fecha_subida,
            fecha_procesado: boletasPagoInversionista.fecha_procesado,
            subido_por_nombre: platform_users.email, // 🔥 Nombre de quien subió
          })
          .from(boletasPagoInversionista)
          .leftJoin(
            platform_users,
            eq(boletasPagoInversionista.subido_por, platform_users.id)
          )
          .where(eq(boletasPagoInversionista.boleta_id, liq.boleta_id))
          .limit(1);

        if (boleta) {
          boletaData = {
            boleta_id: boleta.boleta_id,
            inversionista_id: boleta.inversionista_id,
            boleta_url: boleta.boleta_url,
            estado: boleta.estado,
            monto_boleta: boleta.monto_boleta ? Number(boleta.monto_boleta) : null,
            notas: boleta.notas,
            fecha_subida: boleta.fecha_subida,
            fecha_procesado: boleta.fecha_procesado,
            subido_por: boleta.subido_por_nombre,
          };
          
          console.log(`✅ Boleta encontrada: ${boleta.boleta_url}`);
        } else {
          console.warn(`⚠️ Boleta ID ${liq.boleta_id} no encontrada en BD`);
        }
      } else {
        console.log(`ℹ️ Liquidación ${liq.liquidacion_id} no tiene boleta asociada`);
      }

      // 💳 Traer pagos de esta liquidación
      const pagos = await db
        .select({
          pago_id: pagos_credito_inversionistas_espejo.id,
          pago_credito_id: pagos_credito_inversionistas_espejo.pago_id,
          credito_id: pagos_credito_inversionistas_espejo.credito_id,
          abono_capital: pagos_credito_inversionistas_espejo.abono_capital,
          abono_interes: pagos_credito_inversionistas_espejo.abono_interes,
          abono_iva: pagos_credito_inversionistas_espejo.abono_iva_12,
          porcentaje_participacion:
            pagos_credito_inversionistas_espejo.porcentaje_participacion,
          fecha_pago: pagos_credito_inversionistas_espejo.fecha_pago,
          cuota: pagos_credito_inversionistas_espejo.cuota,
          // Info del crédito
          numero_credito_sifco: creditos.numero_credito_sifco,
          nombre_cliente: usuarios.nombre,
          nit_cliente: usuarios.nit,
          porcentaje_interes_credito: creditos.porcentaje_interes,
        })
        .from(pagos_credito_inversionistas_espejo)
        .leftJoin(
          creditos,
          eq(pagos_credito_inversionistas_espejo.credito_id, creditos.credito_id)
        )
        .leftJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
        .where(
          eq(pagos_credito_inversionistas_espejo.liquidacion_id, liq.liquidacion_id)
        )
        .orderBy(pagos_credito_inversionistas_espejo.fecha_pago);

      // 💰 Calcular ISR y cuota por pago
      const pagosConISR = pagos.map((pago) => {
        const abono_capital = new Big(pago.abono_capital ?? 0);
        const abono_interes = new Big(pago.abono_interes ?? 0);
        const abono_iva = new Big(pago.abono_iva ?? 0);
        const isr = liq.emite_factura ? new Big(0) : abono_interes.times(0.07);

        const cuota = abono_capital
          .plus(abono_interes)
          .plus(liq.emite_factura ? abono_iva : isr.neg());

        return {
          ...pago,
          porcentaje_tasa_interes: Number(new Big(pago.porcentaje_interes_credito ?? 1.5).times(new Big(pago.porcentaje_participacion ?? 80)).div(100)),
          tasa_interes: Number(new Big(pago.porcentaje_interes_credito ?? 1.5)),
          abono_capital: Number(abono_capital),
          abono_interes: Number(abono_interes),
          abono_iva: Number(abono_iva),
          isr: Number(isr),
          cuota: Number(cuota),
        };
      });

      return {
        liquidacion_id: liq.liquidacion_id,
        inversionista_id: liq.inversionista_id,
        nombre_inversionista: liq.nombre_inversionista ?? "TODOS",
        emite_factura: liq.emite_factura,
        dpi: liq.dpi,

        // 🔥 BOLETA ASOCIADA
        boleta: boletaData,

        totales: {
          total_pagos_liquidados: liq.total_pagos_liquidados,
          total_capital: Number(liq.total_capital),
          total_interes: Number(liq.total_interes),
          total_iva: Number(liq.total_iva),
          total_isr: Number(liq.total_isr),
          total_cuota: Number(liq.total_cuota),
        },
        reinversion: {
          reinversion_capital: Number(liq.reinversion_capital),
          reinversion_interes: Number(liq.reinversion_interes),
          reinversion_total: Number(liq.reinversion_total),
        },
        reporte_liquidacion: liq.reporte_liquidacion,
        fecha_liquidacion: liq.fecha_liquidacion,
        pagos: pagosConISR,
      };
    })
  );

  return {
    liquidaciones: liquidacionesConPagos,
    page,
    perPage,
    totalItems,
    totalPages,
  };
}
/**
 * Obtiene el rendimiento de un inversionista por DPI
 * @param dpi - DPI del inversionista
 */
export async function getInvestorPerformance(dpi: string) {
  console.log("[getInvestorPerformance] DPI:", dpi);

  // 1️⃣ Buscar inversionista por DPI
  const [inversionista] = await db
    .select({
      inversionista_id: inversionistas.inversionista_id,
      nombre: inversionistas.nombre,
      dpi: inversionistas.dpi,
    })
    .from(inversionistas)
    .where(eq(inversionistas.dpi, parseInt(dpi)))
    .limit(1);

  if (!inversionista) {
    throw new Error(`No se encontró inversionista con DPI: ${dpi}`);
  }

  // 2️⃣ Obtener todas las inversiones del inversionista
  const inversiones = await db
    .select({
      credito_id: creditos_inversionistas_espejo.credito_id,
      monto_aportado: creditos_inversionistas_espejo.monto_aportado,
      cuota_inversionista: creditos_inversionistas_espejo.cuota_inversionista,
    })
    .from(creditos_inversionistas_espejo)
    .where(
      eq(
        creditos_inversionistas_espejo.inversionista_id,
        inversionista.inversionista_id
      )
    );

  // 3️⃣ Calcular totales
  let capital_total_aportado = new Big(0);
  let rendimiento_total = new Big(0);

  for (const inv of inversiones) {
    // Sumar capital aportado
    capital_total_aportado = capital_total_aportado.plus(
      inv.monto_aportado ?? 0
    );

    // Buscar cuotas LIQUIDADAS de este crédito para este inversionista
    const pagosLiquidados = await db
      .select({
        cuota: pagos_credito_inversionistas_espejo.abono_interes,
      })
      .from(pagos_credito_inversionistas_espejo)
      .where(
        and(
          eq(
            pagos_credito_inversionistas_espejo.inversionista_id,
            inversionista.inversionista_id
          ),
          eq(pagos_credito_inversionistas_espejo.credito_id, inv.credito_id),
          eq(pagos_credito_inversionistas_espejo.estado_liquidacion, "LIQUIDADO")
        )
      );

    // Sumar todas las cuotas liquidadas de este crédito
    const suma_cuotas_liquidadas = pagosLiquidados.reduce(
      (sum, pago) => sum.plus(pago.cuota ?? 0),
      new Big(0)
    );

    // Calcular rendimiento de este crédito
    const rendimiento_credito = suma_cuotas_liquidadas.times(1.2);

    // Acumular rendimiento total
    rendimiento_total = rendimiento_total.plus(rendimiento_credito);
  }

  return {
    inversionista_id: inversionista.inversionista_id,
    nombre: inversionista.nombre,
    dpi: inversionista.dpi?.toString(),
    capital_total_aportado: Number(capital_total_aportado.toString()),
    cantidad_inversiones: inversiones.length,
    rendimiento_estimado: Number(rendimiento_total.toString()),
  };
}

// ============================================================
// 💾 APLICAR PAGOS ESPEJO (Actualizar encabezados)
// ============================================================
// ============================================================
// 💾 APLICAR PAGOS ESPEJO (Actualizar encabezados)
// ============================================================
export async function aplicarPagosEspejo(inversionistaId: number) {
  if (!inversionistaId || isNaN(inversionistaId)) {
    throw new Error("ID de inversionista inválido");
  }

  console.log(`💾 Aplicando cambios de pagos espejo para inversionista ID: ${inversionistaId}`);

  return await db.transaction(async (tx) => {
    // 1. Calcular sumas agrupadas por crédito (UNA sola consulta eficiente)
    // Esto evita el problema N+1 de consultar suma por cada crédito.
    const sumasPorCredito = await tx
      .select({
        creditoId: pagos_credito_inversionistas_espejo.credito_id,
        totalCapital: sql<string>`coalesce(sum(${pagos_credito_inversionistas_espejo.abono_capital}), 0)`,
      })
      .from(pagos_credito_inversionistas_espejo)
      .where(eq(pagos_credito_inversionistas_espejo.inversionista_id, inversionistaId))
      .groupBy(pagos_credito_inversionistas_espejo.credito_id);

    let totalActualizados = 0;

    // 2. Actualizar cada crédito con su suma correspondiente
    // Iteramos sobre los resultados de la suma, que son solo los créditos con pagos.
    for (const suma of sumasPorCredito) {
      if (!suma.creditoId) continue;

      const nuevoMontoAportado = suma.totalCapital; // String para precisión decimal

      // Actualizamos creditos_inversionistas_espejo
      // Usamos el par (inversionista_id, credito_id) para encontrar el registro único
      const resultado = await tx
        .update(creditos_inversionistas_espejo)
        .set({
          monto_aportado: nuevoMontoAportado,
        })
        .where(
          and(
            eq(creditos_inversionistas_espejo.inversionista_id, inversionistaId),
            eq(creditos_inversionistas_espejo.credito_id, suma.creditoId)
          )
        );

      // Drizzle update devuelve result info dependiendo del driver, 
      // pero aquí simplemente contamos las iteraciones exitosas.
      totalActualizados++;
    }

    console.log(`✅ Transacción completada. ${totalActualizados} créditos actualizados.`);
    return { success: true, actualizados: totalActualizados };
  });
}

// ============================================================
// 🗑️ deletePagosEspejoNoLiquidados (Solo elimina NO_LIQUIDADO)
// ============================================================
export async function deletePagosEspejoNoLiquidados(inversionistaId: number) {
  console.log(`\n🔄 DELETE Pagos Espejo NO_LIQUIDADO (inversionista: ${inversionistaId})`);

  try {
    // 1. Eliminar pagos con estado 'NO_LIQUIDADO'
    const deleted = await db
      .delete(pagos_credito_inversionistas_espejo)
      .where(
        and(
          eq(pagos_credito_inversionistas_espejo.inversionista_id, inversionistaId),
          eq(pagos_credito_inversionistas_espejo.estado_liquidacion, 'NO_LIQUIDADO')
        )
      )
      .returning();

    console.log(`✅ ${deleted.length} pagos eliminados.`);
    return { success: true, deletedCount: deleted.length };
  } catch (error) {
    console.error("Error eliminando pagos no liquidados:", error);
    throw error;
  }
}

// ============================================
// 🧪 PRUEBA DE ENVÍO Y SUBIDA A R2
// ============================================
export async function testUploadAndEmail(investorId: number, testEmail: string) {
    console.log(`🧪 Iniciando prueba de envío (PDF Adjunto) para inversionista ${investorId}...`);
    
    // 1. Obtener datos
    const result = await resumeInvestor(investorId, 1, 999);
    if (!result.inversionistas.length) {
        throw new Error("Inversionista no encontrado");
    }
    const inversionista = result.inversionistas[0];

    // 2. Generar PDF Buffer (Sin subir a R2)
    const logoUrl = process.env.LOGO_URL || "";
    console.log(`  📄 Generando PDF en memoria...`);
    const pdfBuffer = await generarPDFBuffer(
        inversionista as any,
        logoUrl
    );

    // 3. Enviar correo con el PDF adjunto
    console.log(`  📧 Enviando correo a ${testEmail} con PDF adjunto`);
    await sendLiquidationEmail({
        to: testEmail,
        investorName: inversionista.nombre_inversionista,
        amount: inversionista.subtotal.total_cuota.toString(),
        creditNumber: "DIAGNOSTIC-TEST",
        date: dayjs().format("DD/MM/YYYY"),
        currencySymbol: inversionista.moneda === "dolares" ? "$" : "Q.",
        attachment: {
            filename: `Test_Liquidacion_${inversionista.nombre_inversionista.replace(/\s+/g, '_')}.pdf`,
            content: pdfBuffer,
        }
    });

    return {
        success: true,
        message: `Prueba completada. PDF generado y enviado como adjunto a ${testEmail}. Se saltó la subida a R2 para evitar errores de autorización.`
    };
}
