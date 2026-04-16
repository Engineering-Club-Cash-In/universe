// app.ts (o donde declares tus rutas Elysia)
import { z } from "zod";
import { formatToUSD } from "../utils/functions/currencyConverter";
import { USD_EXCHANGE_RATE } from "../utils/functions/const";
import { 
  generarYSubirPDFInversionista, 
  generarPDFBuffer, 
  generarYSubirExcelInversionista 
} from "../utils/functions/generalFunctions";
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
  pagos_credito_inversionistas_espejo,
  platform_users,
  reinversiones,
  usuarios,
  liquidacion_locks,
  documentos_inversionista,
  abonos_capital,
} from "../database/db/schema";
import { getSignedDocumentUrl } from "../utils/functions/uploadsFiles";
import { eq, and, sql, inArray, ilike, like, desc, count, SQL } from "drizzle-orm";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import Big from "big.js";
import { sendLiquidationEmail, sendSimpleEmail } from "@cci/email";
import {
  boletaEstaEnPeriodo,
  resolveEstadoLiquidacionResumen,
  type EstadoLiquidacionResumen,
  type EstadoLiquidacionResumenFilter,
} from "../utils/investorLiquidationSummary";
import { addInvestorToCredit } from "./addInvestorToCredit";

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
      tipo_reinversion: config.origen === "espejo" ? (tabla as any).tipo_reinversion : sql<string | null>`NULL`.as("tipo_reinversion"),
      credito_inversionista_espejo_id: config.origen === "espejo" ? (tabla as unknown as typeof creditos_inversionistas_espejo).id : sql<number | null>`NULL`.as("credito_inversionista_espejo_id"),
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
  liquidacionId?: number,
  fechaLiquidacion?: string
) {
  // 🔥 Type assertion segura: sabemos que ambas tablas tienen la misma estructura
  const tabla = config.pagosCreditoInversionistas as typeof pagos_credito_inversionistas;

  // 🔥 TIPADO: SQL[] es el tipo correcto para condiciones en Drizzle
  const pagosConditions: SQL[] = [
    eq(tabla.inversionista_id, inversionistaId),
    eq(tabla.credito_id, creditoId),
  ];

  if (fechaLiquidacion) {
    pagosConditions.push(eq(tabla.estado_liquidacion, "LIQUIDADO"));
    pagosConditions.push(
      sql`${tabla.liquidacion_id} IN (
        SELECT ${liquidaciones.liquidacion_id} FROM ${liquidaciones}
        WHERE ${liquidaciones.inversionista_id} = ${inversionistaId}
          AND ${liquidaciones.fecha_liquidacion}::date = ${fechaLiquidacion}
      )`
    );
  } else if (liquidacionId) {
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
      abono_capital_id: config.origen === "espejo"
        ? (tabla as any).abono_capital_id
        : sql<number | null>`null`,
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
  liquidacionId?: number,
  fechaLiquidacion?: string
) {
  const configOriginal = getTablaConfig("original");
  const configEspejo = getTablaConfig("espejo");

  const [pagosOriginales, pagosEspejos] = await Promise.all([
    consultarPagosInversionista(inversionistaId, creditoId, incluirLiquidados, numeroCuota, configOriginal, soloLiquidados, liquidacionId, fechaLiquidacion),
    consultarPagosInversionista(inversionistaId, creditoId, incluirLiquidados, numeroCuota, configEspejo, soloLiquidados, liquidacionId, fechaLiquidacion),
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
  liquidacionId?: number,
  fechaLiquidacion?: string
) {
  const tabla = config.pagosCreditoInversionistas as typeof pagos_credito_inversionistas;

  const pagosConditions: SQL[] = [
    eq(tabla.inversionista_id, inversionistaId),
    inArray(tabla.credito_id, creditosIds),
  ];

  if (fechaLiquidacion) {
    pagosConditions.push(eq(tabla.estado_liquidacion, "LIQUIDADO"));
    pagosConditions.push(
      sql`${tabla.liquidacion_id} IN (
        SELECT ${liquidaciones.liquidacion_id} FROM ${liquidaciones}
        WHERE ${liquidaciones.inversionista_id} = ${inversionistaId}
          AND ${liquidaciones.fecha_liquidacion}::date = ${fechaLiquidacion}
      )`
    );
  } else if (liquidacionId) {
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
  liquidacionId?: number,
  fechaLiquidacion?: string
) {
  const [pagosOriginales, pagosEspejos] = await Promise.all([
    consultarPagosBulk(inversionistaId, creditosIds, incluirLiquidados, numeroCuota, getTablaConfig("original"), soloLiquidados, liquidacionId, fechaLiquidacion),
    consultarPagosBulk(inversionistaId, creditosIds, incluirLiquidados, numeroCuota, getTablaConfig("espejo"), soloLiquidados, liquidacionId, fechaLiquidacion),
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

      // Si viene banco_id directamente, validar que exista
      if (inv.banco_id) {
        const bancoExiste = await db
          .select()
          .from(bancos)
          .where(eq(bancos.banco_id, Number(inv.banco_id)))
          .limit(1);

        if (bancoExiste.length === 0) {
          errores.push(
            `Inversionista #${index + 1}: banco con ID ${inv.banco_id} no existe`
          );
        } else {
          inv._banco_id = Number(inv.banco_id);
        }
      }

      // Si viene banco (nombre o id), resolverlo
      if (!inv._banco_id && inv.banco) {
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

      // Buscar por inversionista_id primero (para ediciones directas)
      if (inv.inversionista_id) {
        const result = await db
          .select()
          .from(inversionistas)
          .where(eq(inversionistas.inversionista_id, Number(inv.inversionista_id)))
          .limit(1);
        existente = result[0] || null;
      }

      if (!existente && inv.dpi) {
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
// Helper: agrupa rows de left join inversionista + documentos en un solo objeto con array de documentos
async function agruparInversionistasConDocumentos(
  rows: { inversionista: typeof inversionistas.$inferSelect; documento: typeof documentos_inversionista.$inferSelect | null }[]
) {
  const map = new Map<number, any>();

  for (const row of rows) {
    const id = row.inversionista.inversionista_id;
    if (!map.has(id)) {
      map.set(id, { ...row.inversionista, documentos: [] });
    }
    if (row.documento) {
      const url = await getSignedDocumentUrl(row.documento.key);
      map.get(id)!.documentos.push({ ...row.documento, url });
    }
  }

  return Array.from(map.values());
}

// GET: Obtener inversionistas (uno o todos)
export const getInvestors = async ({ query, set }: any) => {
  try {
    // Buscar por ID
    if (query.id) {
      const rows = await db
        .select({ inversionista: inversionistas, documento: documentos_inversionista })
        .from(inversionistas)
        .leftJoin(documentos_inversionista, eq(inversionistas.inversionista_id, documentos_inversionista.inversionista_id))
        .where(eq(inversionistas.inversionista_id, query.id));

      const result = await agruparInversionistasConDocumentos(rows);
      set.status = result.length ? 200 : 404;
      return result.length
        ? result[0]
        : { message: "Inversionista no encontrado" };
    }
    if(query.email){
      const rows = await db
        .select({ inversionista: inversionistas, documento: documentos_inversionista })
        .from(inversionistas)
        .leftJoin(documentos_inversionista, eq(inversionistas.inversionista_id, documentos_inversionista.inversionista_id))
        .where(eq(inversionistas.email, query.email));

      const result = await agruparInversionistasConDocumentos(rows);
      set.status = result.length ? 200 : 404;
      if (!result.length) {
        return { message: "Inversionista no encontrado con ese email" };
      }
      const investor = result[0];
      if (investor.dpi_rep_legal) {
        return { ...investor, dpi: investor.dpi_rep_legal };
      }
      return investor;
    }

    // Buscar por DPI
    if (query.dpi) {
      const dpiNumber = parseInt(query.dpi);
      if (isNaN(dpiNumber)) {
        set.status = 400;
        return { message: "DPI debe ser un número válido" };
      }

      const rows = await db
        .select({ inversionista: inversionistas, documento: documentos_inversionista })
        .from(inversionistas)
        .leftJoin(documentos_inversionista, eq(inversionistas.inversionista_id, documentos_inversionista.inversionista_id))
        .where(eq(inversionistas.dpi, dpiNumber));

      const result = await agruparInversionistasConDocumentos(rows);
      set.status = result.length ? 200 : 404;
      return result.length
        ? result[0]
        : { message: "Inversionista no encontrado con ese DPI" };
    }

    // Buscar por nombre
    if (query.nombre) {
      const rows = await db
        .select({ inversionista: inversionistas, documento: documentos_inversionista })
        .from(inversionistas)
        .leftJoin(documentos_inversionista, eq(inversionistas.inversionista_id, documentos_inversionista.inversionista_id))
        .where(eq(inversionistas.nombre, query.nombre));

      const result = await agruparInversionistasConDocumentos(rows);
      set.status = result.length ? 200 : 404;
      return result.length
        ? result
        : { message: "Inversionista no encontrado" };
    }

    // Si no hay query, trae todos
    const rows = await db
      .select({ inversionista: inversionistas, documento: documentos_inversionista })
      .from(inversionistas)
      .leftJoin(documentos_inversionista, eq(inversionistas.inversionista_id, documentos_inversionista.inversionista_id));

    const all = await agruparInversionistasConDocumentos(rows);
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
  updateMirror: boolean = false,
  txOrDb: Pick<typeof db, 'query' | 'update'> = db
) {


  // 1. Fetch credit details
  const credit = await txOrDb.query.creditos.findFirst({
    where: (c, { eq }) => eq(c.credito_id, credito_id),
  });

  if (!credit) {
    throw new Error("Credit not found");
  }

  // 1.5 Verificar si el inversionista tiene permite_distribucion
  const inversionista = await txOrDb.query.inversionistas.findFirst({
    where: (i, { eq }) => eq(i.inversionista_id, inversionista_id),
  });

  const permiteDistribucion = inversionista?.permite_distribucion ?? false;

  // 2. Fetch all investors for this credit
  // Determine which table to query based on updateMirror flag
  let investors;

  if (updateMirror) {
    investors = await txOrDb.query.creditos_inversionistas_espejo.findMany({
      where: (ci, { eq, and }) =>
        and(
          eq(ci.inversionista_id, inversionista_id),
          eq(ci.credito_id, credito_id)
        ),
    });
  } else {
    investors = await txOrDb.query.creditos_inversionistas.findMany({
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
      await txOrDb.update(creditos_inversionistas_espejo).set({ ...setData, updated_at: new Date() })
        .where(eq(creditos_inversionistas_espejo.id, inv.id));
    } else {
      await txOrDb.update(creditos_inversionistas).set(setData)
        .where(eq(creditos_inversionistas.id, inv.id));
    }

    // Si permite_distribucion = true, también actualizar la OTRA tabla con los mismos valores
    if (permiteDistribucion) {
      const otraTabla = updateMirror ? creditos_inversionistas : creditos_inversionistas_espejo;
      const otraSetData = otraTabla === creditos_inversionistas_espejo ? { ...setData, updated_at: new Date() } : setData;
      await txOrDb.update(otraTabla).set(otraSetData)
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

// !ESTA FUNCION NO DEBERIA DE USARSE:

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
  liquidacionId?: number,
  fechaLiquidacion?: string
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
        total_cuota_sin_reinversion: new Big(0),
        total_reinversion: new Big(0),
        total_reinversion_capital: new Big(0),
        total_reinversion_interes: new Big(0),
        total_monto_aportado: new Big(0),
        totalAbonoGeneralInteres: new Big(0),
        total_capital_creditos: new Big(0),
        total_capital_actual: new Big(0),
      };

      const formatValue = (val: string | number | null | undefined) =>
        inv.moneda === "dolares" ? formatToUSD(val, inv.inversionista_id) : Number(val || 0);

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
              liquidacionId,
              fechaLiquidacion
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
              liquidacionId,
              fechaLiquidacion
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
          let total_cuota_sin_reinversion = new Big(0);
          let total_reinversion_capital = new Big(0);
          let total_reinversion_interes = new Big(0);
          let total_reinversion_neta_global = new Big(0);

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
          // Pre-cargar abonos a capital referenciados por los pagos
          const abonoIds = pagos
            .map((p) => (p as any).abono_capital_id)
            .filter((id): id is number => id != null);

          let abonosMap = new Map<number, { monto: string; tipo: string }>();
          if (abonoIds.length > 0) {
            const abonos = await db
              .select({
                abono_id: abonos_capital.abono_id,
                monto: abonos_capital.monto,
                tipo: abonos_capital.tipo,
              })
              .from(abonos_capital)
              .where(inArray(abonos_capital.abono_id, abonoIds));

            for (const a of abonos) {
              abonosMap.set(a.abono_id, { monto: a.monto, tipo: a.tipo });
            }
          }

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
              const isr = abono_interes.times(0.07);
              const cuota = pago.cuota ?? 0;
              let cuota_inversor;
              let abonoGeneralInteres;
              let reinvCapital = new Big((pago as any).reinv_capital ?? 0);
              let reinvInteres = new Big((pago as any).reinv_interes ?? 0);

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

              let reinversionActual = inv.reinversion;
              if (inv.reinversion === "reinversion_combinada") {
                reinversionActual = c.tipo_reinversion || "sin_reinversion";
              }

              switch (reinversionActual) {
                case "sin_reinversion":
                  cuota_inversor = abono_capital
                    .plus(abono_interes)
                    .plus(inv.emite_factura ? abono_iva : isr.neg());
                  break;

                case "reinversion_capital":
                  reinvCapital = abono_capital;
                  cuota_inversor = abonoGeneralInteres;
                  break;

                case "reinversion_interes":
                  reinvInteres = abonoGeneralInteres;
                  cuota_inversor = abono_capital;
                  break;

                case "reinversion_total":
                  reinvCapital = abono_capital;
                  reinvInteres = abonoGeneralInteres;
                  cuota_inversor = new Big(0);
                  break;

                case "reinversion_variable":
                  // Se calcula como sin_reinversion per-pago; el allCandidatese global se aplica después
                  cuota_inversor = abono_capital
                    .plus(abono_interes)
                    .plus(inv.emite_factura ? abono_iva : isr.neg());
                  break;

                case "reinversion_combinada":
                  // 🔑 Lógica combinada: tomamos lo que NO se reinvierte y le aplicamos impuesto
                  const capRestante = abono_capital.minus(reinvCapital);
                  const intRestante = abono_interes.minus(reinvInteres);
                  const isrRestante = inv.emite_factura ? new Big(0) : intRestante.times(0.07);
                  cuota_inversor = capRestante.plus(intRestante).plus(inv.emite_factura ? abono_iva : isrRestante.neg());
                  break;

                default:
                  cuota_inversor = abono_capital
                    .plus(abono_interes)
                    .plus(inv.emite_factura ? abono_iva : isr.neg());
              }

              // 🔑 Acumular Sin Reinversión de forma independiente (Neto Real)
              const netIntParaMiso = abono_interes.plus(inv.emite_factura ? abono_iva : isr.neg());
              const pagoNetoReal = abono_capital.plus(netIntParaMiso);
              total_cuota_sin_reinversion = total_cuota_sin_reinversion.plus(pagoNetoReal);

              // 🔑 Reinversión Neta (Interés - ISR proporcional)
              const isrReinv = inv.emite_factura ? new Big(0) : reinvInteres.times(0.07);
              const totalReinvNeta = reinvCapital.plus(reinvInteres).minus(isrReinv);
              const netReinvInt = reinvInteres.minus(isrReinv);
              
              total_reinversion_neta_global = total_reinversion_neta_global.plus(totalReinvNeta);
              total_reinversion_capital = total_reinversion_capital.plus(reinvCapital);
              total_reinversion_interes = total_reinversion_interes.plus(netReinvInt);

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
                isr: inv.emite_factura ? 0 : formatValue(isr.round(2).toString()),
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
                abono_capital_id: (pago as any).abono_capital_id ?? null,
                abono_capital_detalle: (pago as any).abono_capital_id
                  ? abonosMap.get((pago as any).abono_capital_id) ?? null
                  : null,
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
          subtotal.total_cuota_sin_reinversion = subtotal.total_cuota_sin_reinversion.plus(total_cuota_sin_reinversion);
          subtotal.total_reinversion = subtotal.total_reinversion.plus(total_reinversion_neta_global);
          subtotal.total_reinversion_capital = subtotal.total_reinversion_capital.plus(total_reinversion_capital);
          subtotal.total_reinversion_interes = subtotal.total_reinversion_interes.plus(total_reinversion_interes);
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
            credito_inversionista_espejo_id: (c as any).credito_inversionista_espejo_id ?? null,
            plazo: credito.plazo,
            pagos: pagos_detalle,
            total_abono_capital: formatValue(total_abono_capital.toString()),
            total_abono_interes: formatValue(total_abono_interes.toString()),
            total_abono_iva: formatValue(
              (inv.emite_factura
                ? total_abono_iva
                : total_abono_interes.round(2).times(0.12)
              ).round(2).toString()
            ),
            total_isr: formatValue(
              (inv.emite_factura
                ? new Big(0)
                : total_abono_interes.round(2).times(0.07)
              ).round(2).toString()
            ),
            total_cuota: formatValue(total_cuota.round(2).toString()),
            meses_en_credito,
            origen: c.origen, // 🆕 NUEVO: Indica si viene de tabla original o espejo
            tipo_reinversion: inv.reinversion === "reinversion_combinada" ? c.tipo_reinversion : null,
          };
        })
      );

      // Aplicar reinversión variable como allCandidatese global sobre el total
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
        reinversion: inv.reinversion,
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
          total_abono_iva: formatValue(
            (inv.emite_factura
              ? subtotal.total_abono_iva
              : subtotal.total_abono_interes.round(2).times(0.12)
            ).round(2).toString()
          ),
          total_isr: formatValue(subtotal.total_isr.round(2).toString()),
          total_cuota_sin_reinversion: formatValue(subtotal.total_cuota_sin_reinversion.toString()),
          total_cuota_con_reinversion: formatValue(subtotal.total_cuota_sin_reinversion.minus(subtotal.total_reinversion).toString()),
          total_cuota: formatValue(subtotal.total_cuota_sin_reinversion.minus(subtotal.total_reinversion).toString()),
          total_reinversion_capital: formatValue(subtotal.total_reinversion_capital.toString()),
          total_reinversion_interes: formatValue(subtotal.total_reinversion_interes.toString()),
          total_reinversion:         formatValue(subtotal.total_reinversion.toString()),
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
  liquidacionId?: number,
  fechaLiquidacion?: string,
  rawValues = false
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

  const formatValue = (val: string | number) =>
    rawValues ? Number(val) : (inv.moneda === "dolares" ? formatToUSD(val, inv.inversionista_id) : Number(val));

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
      liquidacionId,
      fechaLiquidacion
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
      liquidacionId,
      fechaLiquidacion
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
    total_cuota_sin_reinversion: new Big(0),
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
      const abono_iva = new Big(pago.abono_iva_12 ?? 0).round(2);
      const isr = abono_interes.times(0.07);

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

      let reinversionActual = inv.reinversion;
      if (inv.reinversion === "reinversion_combinada") {
        reinversionActual = c.tipo_reinversion || "sin_reinversion";
      }

      switch (reinversionActual) {
        case "sin_reinversion":
          cuota_inversor = abono_capital.plus(interesTotal);
          break;
        case "reinversion_capital":
          reinvCapital = abono_capital;
          cuota_inversor = interesTotal;
          break;
        case "reinversion_interes":
          reinvInteres = abono_interes;
          cuota_inversor = abono_capital;
          break;
        case "reinversion_total":
          reinvCapital = abono_capital;
          reinvInteres = abono_interes;
          cuota_inversor = new Big(0);
          break;
        case "reinversion_variable":
          // Se calcula como sin_reinversion per-pago; el allCandidatese global se aplica después
          cuota_inversor = abono_capital.plus(interesTotal);
          break;
        default:
          cuota_inversor = abono_capital.plus(interesTotal);
      }

      capital_actual = capital_actual.minus(abono_capital);

      subtotal.total_abono_capital = subtotal.total_abono_capital.plus(abono_capital);
      subtotal.total_abono_interes = subtotal.total_abono_interes.plus(abono_interes);
      subtotal.total_abono_iva = subtotal.total_abono_iva.plus(abono_iva);
      if (!inv.emite_factura) {
        subtotal.total_isr = subtotal.total_isr.plus(isr);
      }
      subtotal.total_cuota = subtotal.total_cuota.plus(cuota_inversor);
      subtotal.totalAbonoGeneralInteres = subtotal.totalAbonoGeneralInteres.plus(abonoGeneralInteres);
      
      // 🔑 ACUMULADOR NETO INDEPENDIENTE
      const pagoNetoGlobal = abono_capital.plus(interesTotal);
      subtotal.total_cuota_sin_reinversion = subtotal.total_cuota_sin_reinversion.plus(pagoNetoGlobal);
      // 🔑 Reinversión Neta (Fuente de Verdad)
      const isrReinvGlobal = inv.emite_factura ? new Big(0) : reinvInteres.times(0.07);
      const netReinvGlobal = reinvCapital.plus(reinvInteres).minus(isrReinvGlobal);
      const netReinvIntGlobal = reinvInteres.minus(isrReinvGlobal);

      subtotal.total_reinversion = subtotal.total_reinversion.plus(netReinvGlobal);
      subtotal.total_reinversion_capital = subtotal.total_reinversion_capital.plus(reinvCapital);
      subtotal.total_reinversion_interes = subtotal.total_reinversion_interes.plus(netReinvIntGlobal);
    }

    subtotal.total_monto_aportado = subtotal.total_monto_aportado.plus(new Big(c.monto_aportado ?? 0));
    subtotal.total_capital_creditos = subtotal.total_capital_creditos.plus(capital_credito);
    subtotal.total_capital_actual = subtotal.total_capital_actual.plus(capital_actual);
  }

  // Aplicar reinversión variable como allCandidatese global sobre el total
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
      total_abono_capital: formatValue(subtotal.total_abono_capital.round(2).toString()),
      total_abono_interes: formatValue(subtotal.total_abono_interes.round(2).toString()),
      total_abono_iva: formatValue(
        (inv.emite_factura
          ? subtotal.total_abono_iva
          : subtotal.total_abono_interes.round(2).times(0.12)
        ).round(2).toString()
      ),
      total_isr: formatValue(subtotal.total_isr.round(2).toString()),
      total_cuota_sin_reinversion: formatValue(subtotal.total_cuota_sin_reinversion.round(2).toString()),
      total_cuota_con_reinversion: formatValue(subtotal.total_cuota.round(2).toString()),
      total_monto_aportado: formatValue(subtotal.total_monto_aportado.round(2).toString()),
      total_abono_general_interes: formatValue(subtotal.totalAbonoGeneralInteres.round(2).toString()),
      total_capital_creditos: formatValue(subtotal.total_capital_creditos.round(2).toString()),
      total_capital_actual: formatValue(subtotal.total_capital_actual.round(2).toString()),
      total_reinversion_capital: formatValue(subtotal.total_reinversion_capital.round(2).toString()),
      total_reinversion_interes: formatValue(subtotal.total_reinversion_interes.round(2).toString()),
      total_reinversion: formatValue(subtotal.total_reinversion.round(2).toString()),
    },
  };
}

export async function updateLiquidacionReporteUrl(liquidacion_id: number, url: string) {
  const [liquidacion] = await db
    .select({
      liquidacion_id: liquidaciones.liquidacion_id,
      fecha_liquidacion: liquidaciones.fecha_liquidacion,
      reporte_liquidacion_url: liquidaciones.reporte_liquidacion_url,
    })
    .from(liquidaciones)
    .where(eq(liquidaciones.liquidacion_id, liquidacion_id))
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

/**
 * Obtiene las liquidaciones (con inversionista_id y liquidacion_id) de una fecha dada.
 */
export async function getLiquidacionesPorFecha(fecha: string) {
  return await db
    .select({
      liquidacion_id: liquidaciones.liquidacion_id,
      inversionista_id: liquidaciones.inversionista_id,
    })
    .from(liquidaciones)
    .where(sql`${liquidaciones.fecha_liquidacion}::date = ${fecha}`);
}

// ============================================
// Revertir liquidación por liquidacion_id
// ============================================

/**
 * Revierte completamente una liquidación dado su liquidacion_id.
 * Deshace todos los efectos de liquidateByInvestorId en orden inverso,
 * dentro de una transacción para garantizar atomicidad.
 */
export async function revertirLiquidacion(liquidacion_id: number) {
  return await db.transaction(async (tx) => {
    // ──────────────────────────────────────────────
    // PASO 1: Obtener la liquidación y validar que existe
    // ──────────────────────────────────────────────
    const [liquidacion] = await tx
      .select()
      .from(liquidaciones)
      .where(eq(liquidaciones.liquidacion_id, liquidacion_id));

    if (!liquidacion) {
      throw new Error(`No se encontró la liquidación con id: ${liquidacion_id}`);
    }

    const inv_id = liquidacion.inversionista_id;
    console.log(`\n🔄 Revirtiendo liquidación ${liquidacion_id} del inversionista ${inv_id}`);

    // ──────────────────────────────────────────────
    // PASO 2: Obtener todos los pagos espejo asociados a esta liquidación
    // ──────────────────────────────────────────────
    const pagosLiquidados = await tx
      .select()
      .from(pagos_credito_inversionistas_espejo)
      .where(eq(pagos_credito_inversionistas_espejo.liquidacion_id, liquidacion_id));

    console.log(`  📊 Pagos asociados a esta liquidación: ${pagosLiquidados.length}`);

    // ──────────────────────────────────────────────
    // PASO 3: Restaurar monto_aportado en creditos_inversionistas_espejo
    //   Agrupamos pagos por credito_id, sumamos abono_capital y llamamos
    //   processAndReplaceCreditInvestors con addition=true para sumar de vuelta
    // ──────────────────────────────────────────────
    const pagosPorCredito = new Map<number, typeof pagosLiquidados>();
    for (const pago of pagosLiquidados) {
      if (!pagosPorCredito.has(pago.credito_id)) {
        pagosPorCredito.set(pago.credito_id, []);
      }
      pagosPorCredito.get(pago.credito_id)!.push(pago);
    }

    for (const [creditoId, pagos] of pagosPorCredito) {
      const totalAbonoCapital = pagos.reduce(
        (acc, p) => acc.plus(new Big(p.abono_capital ?? 0)),
        new Big(0)
      );

      if (totalAbonoCapital.gt(0)) {
        // addition=true → suma de vuelta el capital al monto_aportado
        await processAndReplaceCreditInvestors(
          creditoId,
          totalAbonoCapital.toNumber(),
          true,       // addition: sumar de vuelta
          inv_id,
          true        // updateMirror: tabla espejo
        );
        console.log(`  ✅ Crédito ${creditoId}: monto_aportado restaurado (+${totalAbonoCapital.toFixed(2)})`);
      }
    }

    // ──────────────────────────────────────────────
    // PASO 4: Revertir pagos espejo a NO_LIQUIDADO
    //   Quitamos la referencia a la liquidación y cambiamos el estado
    // ──────────────────────────────────────────────
    const pagosIds = pagosLiquidados.map((p) => p.id);
    if (pagosIds.length > 0) {
      await tx
        .update(pagos_credito_inversionistas_espejo)
        .set({
          estado_liquidacion: "NO_LIQUIDADO",
          liquidacion_id: null,
          updated_at: new Date(),
        })
        .where(inArray(pagos_credito_inversionistas_espejo.id, pagosIds));

      console.log(`  ✅ ${pagosIds.length} pagos revertidos a NO_LIQUIDADO`);
    }

    // ──────────────────────────────────────────────
    // PASO 5: Revertir cuotas del crédito
    //   Marcamos liquidado_inversionistas = false y limpiamos fecha
    // ──────────────────────────────────────────────
    const allPagoIds = [...new Set(pagosLiquidados.map((p) => p.pago_id))];
    if (allPagoIds.length > 0) {
      const cuotasDeLosPagos = await tx
        .select({ cuota_id: pagos_credito.cuota_id })
        .from(pagos_credito)
        .where(inArray(pagos_credito.pago_id, allPagoIds));

      const uniqueCuotaIds = [
        ...new Set(
          cuotasDeLosPagos
            .map((c) => c.cuota_id)
            .filter((id): id is number => id !== null)
        ),
      ];

      if (uniqueCuotaIds.length > 0) {
        await tx
          .update(cuotas_credito)
          .set({
            liquidado_inversionistas: false,
            fecha_liquidacion_inversionistas: null,
          })
          .where(inArray(cuotas_credito.cuota_id, uniqueCuotaIds));

        console.log(`  ✅ ${uniqueCuotaIds.length} cuotas revertidas`);
      }
    }

    // ──────────────────────────────────────────────
    // PASO 6: Eliminar boleta asociada (si existe)
    // ──────────────────────────────────────────────
    if (liquidacion.boleta_id) {
      await tx
        .delete(boletasPagoInversionista)
        .where(eq(boletasPagoInversionista.boleta_id, liquidacion.boleta_id));

      console.log(`  ✅ Boleta ${liquidacion.boleta_id} eliminada`);
    }

    // ──────────────────────────────────────────────
    // PASO 7: Revertir reinversión
    //   Restamos el monto reinvertido del saldo_reinversion del inversionista
    //   y restauramos los montos en la tabla reinversiones
    // ──────────────────────────────────────────────
    const reinvTotal = new Big(liquidacion.reinversion_total ?? 0);
    if (reinvTotal.gt(0)) {
      // Restar del saldo_reinversion
      await tx
        .update(inversionistas)
        .set({
          saldo_reinversion: sql`${inversionistas.saldo_reinversion} - ${reinvTotal.toFixed(2)}::numeric`,
        })
        .where(eq(inversionistas.inversionista_id, inv_id));

      // Restaurar montos en reinversiones
      await tx
        .update(reinversiones)
        .set({
          monto_capital: liquidacion.reinversion_capital ?? "0",
          monto_interes: liquidacion.reinversion_interes ?? "0",
          monto_total: liquidacion.reinversion_total ?? "0",
        })
        .where(eq(reinversiones.inversionista_id, inv_id));

      console.log(`  ✅ Reinversión revertida (-${reinvTotal.toFixed(2)} del saldo)`);
    }

    // ──────────────────────────────────────────────
    // PASO 8: Eliminar la liquidación
    // ──────────────────────────────────────────────
    await tx
      .delete(liquidaciones)
      .where(eq(liquidaciones.liquidacion_id, liquidacion_id));

    console.log(`  ✅ Liquidación ${liquidacion_id} eliminada`);
    console.log(`🔄 Reversión completada exitosamente\n`);

    return {
      success: true,
      liquidacion_id,
      inversionista_id: inv_id,
      pagos_revertidos: pagosLiquidados.length,
      creditos_afectados: pagosPorCredito.size,
    };
  });
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
    .select({
      id: pagos_credito_inversionistas_espejo.id,
      moneda: inversionistas.moneda,
    })
    .from(pagos_credito_inversionistas_espejo)
    .innerJoin(
      inversionistas,
      eq(
        pagos_credito_inversionistas_espejo.inversionista_id,
        inversionistas.inversionista_id
      )
    )
    .where(inArray(pagos_credito_inversionistas_espejo.id, ids));

  // Crear un mapa de { id: moneda } para buscar fácilmente
  const monedaPorId = new Map(encontrados.map((r) => [r.id, r.moneda]));

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
      let finalAbonoCapital = p.abono_capital;
      let finalAbonoInteres = p.abono_interes;
      let finalCuota = p.cuota;

      const moneda = monedaPorId.get(p.id);

      // Si la moneda es dólares, convertimos los valores del request a Quetzales
      if (moneda === "dolares") {
        const tcambio = USD_EXCHANGE_RATE || 7.9;
        finalAbonoCapital = (Number(p.abono_capital) * tcambio).toFixed(2);
        finalAbonoInteres = (Number(p.abono_interes) * tcambio).toFixed(2);
        finalCuota = (Number(p.cuota) * tcambio).toFixed(2);
      }

      // 🆕 Recalcular IVA basado en el interés convertido (Siempre 12%)
      const numericInteres = Number(finalAbonoInteres) || 0;
      const calculadoIva = (numericInteres * 0.12).toFixed(2);

      return db
        .update(pagos_credito_inversionistas_espejo)
        .set({
          abono_capital:            finalAbonoCapital,
          abono_interes:            finalAbonoInteres,
          abono_iva_12:             calculadoIva,
          porcentaje_participacion: p.porcentaje_participacion,
          cuota:                    finalCuota,
          ...(p.estado_liquidacion && { estado_liquidacion: p.estado_liquidacion }),
          updated_at: new Date(),
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
      tipo_reinversion:    creditos_inversionistas_espejo.tipo_reinversion,
    })
    .from(creditos_inversionistas_espejo)
    .where(eq(creditos_inversionistas_espejo.inversionista_id, inv.inversionista_id));

  const totalMontoBase = creditosEspejo.reduce(
    (acc, c) => acc.plus(new Big(c.monto_aportado_base ?? 0)),
    new Big(0)
  );

  const formatValue = (val: string | number) => inv.moneda === "dolares" ? formatToUSD(val, inv.inversionista_id) : Number(val);

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
    total_abono_general_interes: new Big(0),
    total_capital_creditos:   new Big(0),
    total_capital_actual:     new Big(0),
    total_reinversion_capital: new Big(0),
    total_reinversion_interes: new Big(0),
    total_reinversion:         new Big(0),
    total_cuota_sin_reinversion: new Big(0),
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

      // Para reinversión combinada, aplicar la regla específica del crédito
      let reinversionActual = inv.reinversion;
      if (inv.reinversion === "reinversion_combinada") {
        reinversionActual = credito.tipo_reinversion || "sin_reinversion";
      }

      switch (reinversionActual) {
        case "sin_reinversion":
          cuota_inversor = abono_capital.plus(interesTotal);
          break;
        case "reinversion_capital":
          reinvCapital = abono_capital;
          cuota_inversor = interesTotal;
          break;
        case "reinversion_interes":
          reinvInteres = interesTotal;
          cuota_inversor = abono_capital;
          break;
        case "reinversion_total":
          reinvCapital = abono_capital;
          reinvInteres = interesTotal;
          cuota_inversor = new Big(0);
          break;
        case "reinversion_variable":
          // Se calcula como sin_reinversion per-pago; el allCandidatese global se aplica después
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
      sg.total_abono_general_interes = sg.total_abono_general_interes.plus(abonoGeneralInteres);
      
      // 🔑 ACUMULADOR NETO INDEPENDIENTE
      const pagoNetoEspejo = abono_capital.plus(interesTotal);
      sg.total_cuota_sin_reinversion = sg.total_cuota_sin_reinversion.plus(pagoNetoEspejo);
      // 🔑 Reinversión Neta (Fuente de Verdad)
      const isrReinvMirror = inv.emite_factura ? new Big(0) : reinvInteres.times(0.07);
      const netReinvMirror = reinvCapital.plus(reinvInteres).minus(isrReinvMirror);
      const netReinvIntMirror = reinvInteres.minus(isrReinvMirror);

      sg.total_reinversion         = sg.total_reinversion.plus(netReinvMirror);
      sg.total_reinversion_capital = sg.total_reinversion_capital.plus(reinvCapital);
      sg.total_reinversion_interes = sg.total_reinversion_interes.plus(netReinvIntMirror);
    }

    // 🔑 Saldo actual = monto_aportado_base - SUM(abono_capital de pagos espejo)
    const capital_actual = montoAportadoBase.minus(abonoCapitalCredito);
    sg.total_monto_aportado = sg.total_monto_aportado.plus(capital_actual);
    sg.total_capital_actual = sg.total_capital_actual.plus(capital_actual);
  }

  // Aplicar reinversión variable como allCandidatese global sobre el total
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
      total_abono_capital:      formatValue(sg.total_abono_capital.round(2).toString()),
      total_abono_interes:      formatValue(sg.total_abono_interes.round(2).toString()),
      total_abono_iva:          formatValue(sg.total_abono_iva.round(2).toString()),
      total_isr:                formatValue(sg.total_isr.round(2).toString()),
      total_cuota_sin_reinversion: formatValue(sg.total_cuota_sin_reinversion.round(2).toString()),
      total_cuota_con_reinversion: formatValue(sg.total_cuota.round(2).toString()),
      total_monto_aportado:     formatValue(sg.total_monto_aportado.round(2).toString()),
      total_abono_general_interes: formatValue(sg.total_abono_general_interes.round(2).toString()),
      total_capital_creditos:   formatValue(sg.total_capital_creditos.round(2).toString()),
      total_capital_actual:     formatValue(sg.total_capital_actual.round(2).toString()),
      total_reinversion_capital: formatValue(sg.total_reinversion_capital.round(2).toString()),
      total_reinversion_interes: formatValue(sg.total_reinversion_interes.round(2).toString()),
      total_reinversion:         formatValue(sg.total_reinversion.round(2).toString()),
    },
  };
}

export const liquidateByInvestorSchema = z.object({
  inversionista_id: z.number().optional(), // 🆕 Ahora es opcional
});
export async function liquidateByInvestorId(inversionista_id?: number) {
  // Verificar si ya hay una liquidación en proceso para este inversionista (o masiva)
  const lockExistente = await db
    .select({ id: liquidacion_locks.id, started_at: liquidacion_locks.started_at })
    .from(liquidacion_locks)
    .where(
      and(
        inversionista_id
          ? eq(liquidacion_locks.inversionista_id, inversionista_id)
          : sql`${liquidacion_locks.inversionista_id} IS NULL`,
        eq(liquidacion_locks.estado, "EN_PROCESO")
      )
    )
    .limit(1);

  if (lockExistente.length > 0) {
    console.warn(`⚠️ Liquidación ya en proceso para: ${inversionista_id ?? "TODOS"}`);
    return {
      message: `Ya hay una liquidación en proceso para ${inversionista_id ? `inversionista ${inversionista_id}` : "todos los inversionistas"}. Iniciada: ${lockExistente[0].started_at}. Intente más tarde.`,
      success: false,
      error: "LIQUIDACION_EN_PROCESO",
    };
  }

  // Crear lock en BD
  const [lock] = await db
    .insert(liquidacion_locks)
    .values({
      inversionista_id: inversionista_id ?? null,
      estado: "EN_PROCESO",
    })
    .returning({ id: liquidacion_locks.id });

  try {
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
          abono_capital_id: pagos_credito_inversionistas_espejo.abono_capital_id,
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
      // rawValues=true para que los totales vengan siempre en Q (sin convertir a USD)
      const totalesResult = await getInvestorTotalsGlobales(inv_id, undefined, "espejos", false, undefined, false, undefined, undefined, true);
      const totales = totalesResult.totales;
      const cantidadPagos = pagosNoLiquidados.length;

      console.log(`  📊 Total pagos a liquidar: ${cantidadPagos}`);

      const reinvCapital = totales.total_reinversion_capital ?? 0;
      const reinvInteres = totales.total_reinversion_interes ?? 0;
      const reinvTotal = totales.total_reinversion ?? 0;

      // ========================================
      // FASE 2: TRANSACCION (datos financieros)
      // Si algo falla, se hace rollback de TODO
      // ========================================
      const { liquidacion, updateResult, debeReinvertir, montoReinvertido } = await db.transaction(async (tx) => {

        // Crear registro de liquidación
        const [liquidacion] = await tx
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
          await tx
            .update(boletasPagoInversionista)
            .set({ estado: "PROCESADO", fecha_procesado: new Date() })
            .where(eq(boletasPagoInversionista.boleta_id, boletaPendiente.boleta_id));
          console.log(`  ✅ Boleta ${boletaPendiente.boleta_id} marcada como PROCESADO`);
        }

        // Reinversiones
        const montoReinvertido = new Big(reinvTotal);
        let debeReinvertir = false;
        if (montoReinvertido.gt(0)) {
          await tx.update(inversionistas)
            .set({
              saldo_reinversion: sql`${inversionistas.saldo_reinversion} + ${montoReinvertido.toFixed(2)}::numeric`,
            })
            .where(eq(inversionistas.inversionista_id, inv_id));

          await tx.update(reinversiones)
            .set({ monto_capital: "0", monto_interes: "0", monto_total: "0" })
            .where(eq(reinversiones.inversionista_id, inv_id));

          debeReinvertir = true;
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
              true,
              tx
            );
          }
        }

        let updateResult: any = { rowCount: 0 };
        if (pagosIds.length > 0) {
          updateResult = await tx
            .update(pagos_credito_inversionistas_espejo)
            .set({
              estado_liquidacion: "LIQUIDADO",
              liquidacion_id: liquidacion.liquidacion_id,
              updated_at: new Date(),
            })
            .where(inArray(pagos_credito_inversionistas_espejo.id, pagosIds));
        }

        console.log(`  ✅ ${updateResult.rowCount ?? 0} pagos espejo actualizados`);

        // Marcar abonos a capital como liquidados
        const abonoIdsALiquidar = [
          ...new Set(
            pagosNoLiquidados
              .map((p) => p.abono_capital_id)
              .filter((id): id is number => id != null)
          ),
        ];
        if (abonoIdsALiquidar.length > 0) {
          await tx
            .update(abonos_capital)
            .set({ liquidado: true, updated_at: new Date() })
            .where(inArray(abonos_capital.abono_id, abonoIdsALiquidar));
          console.log(`  ✅ ${abonoIdsALiquidar.length} abono(s) a capital marcados como liquidados`);
        }

        // Marcar cuotas como liquidado_inversionistas
        const allPagoIds = [...new Set(pagosNoLiquidados.map((p) => p.pago_id))];
        if (allPagoIds.length > 0) {
          const cuotasDeLosPagos = await tx
            .select({ cuota_id: pagos_credito.cuota_id })
            .from(pagos_credito)
            .where(inArray(pagos_credito.pago_id, allPagoIds));

          const uniqueCuotaIds = [...new Set(cuotasDeLosPagos.map((c) => c.cuota_id))];
          if (uniqueCuotaIds.length > 0) {
            const fechaGuatemala = new Date(
              new Date().toLocaleString("en-US", { timeZone: "America/Guatemala" })
            );
            await tx
              .update(cuotas_credito)
              .set({
                liquidado_inversionistas: true,
                fecha_liquidacion_inversionistas: fechaGuatemala,
              })
              .where(inArray(cuotas_credito.cuota_id, uniqueCuotaIds));
            console.log(`  ✅ ${uniqueCuotaIds.length} cuotas actualizadas`);
          }
        }

        return { liquidacion, updateResult, debeReinvertir, montoReinvertido };
      });

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
          // Recalcular totales específicamente para esta liquidación (ya persistida)
          const postTotales = await getInvestorTotalsGlobales(
            inv_id,
            undefined,
            "espejos",
            false,
            undefined,
            true, // soloLiquidados
            liquidacion.liquidacion_id
          );
          inversionista.subtotal = postTotales.totales as any;

          console.log(`  📄 Generando Excel...`);
          const logoUrl = process.env.LOGO_URL || "";
          const filename = `liquidacion_${liquidacion.liquidacion_id}_${Date.now()}.xlsx`;
          const excelResult = await generarYSubirExcelInversionista(
            inversionista as any,
            filename,
            logoUrl
          );
          const url = excelResult.url;
          const excelBuffer = Buffer.from(excelResult.excelBuffer);

          console.log(`  ✅ Excel generado: ${filename}`);

          // Actualizar liquidación con URL del reporte
          await db
            .update(liquidaciones)
            .set({ reporte_liquidacion_url: url })
            .where(eq(liquidaciones.liquidacion_id, liquidacion.liquidacion_id));

          // Enviar correo (best-effort)
          if (inversionista.email && excelBuffer) {
            console.log(`  📧 Preparando envío de correo para ${inversionista.email}...`);
            try {
              // Validar que subtotal existe para evitar crash
              const subtotalStr = inversionista.subtotal?.total_cuota_con_reinversion?.toString() || "0";
              
              const emailResult = await sendLiquidationEmail({
                to: inversionista.email,
                investorName: inversionista.nombre_inversionista,
                amount: subtotalStr,
                creditNumber: "Múltiples",
                date: dayjs().format("MMMM YYYY"),
                currencySymbol: inversionista.moneda === "dolares" ? "$" : "Q.",
                reportUrl: url,
                attachment: {
                  filename: `Liquidacion_${inversionista.nombre_inversionista.replace(/\s+/g, '_')}_${dayjs().format('YYYYMMDD')}.xlsx`,
                  content: excelBuffer,
                }
              });
              
              if (emailResult.success) {
                console.log(`  ✅ Correo enviado exitosamente a ${inversionista.email}`);
              } else {
                console.error(`  ❌ Error devuelto por el servicio de correo para ${inversionista.email}:`, emailResult.error);
              }
            } catch (emailError) {
              console.error(`  ❌ Error inesperado al intentar enviar correo a ${inversionista.email}:`, emailError);
            }
          } else {
            if (!inversionista.email) {
              console.warn(`  ⚠️ El inversionista ${inversionista.nombre_inversionista} (${inv_id}) no tiene un correo electrónico configurado en su ficha. Se omitió la notificación.`);
            }
            if (!excelBuffer) {
              console.error(`  ❌ No se pudo adjuntar el reporte Excel porque el generador devolvió un buffer vacío para el inversionista ${inv_id}.`);
            }
          }

          reportesGenerados.push({
            inversionista_id: inv_id,
            url,
            boleta_id: boletaPendiente?.boleta_id ?? 0,
            boleta_url: boletaPendiente?.boleta_url ?? "",
          });
        }

        // ========================================
        // FASE 4: REINVERSIÓN AUTOMÁTICA (post-reporte)
        // Si hubo monto de reinversión, se llama addInvestorToCredit
        // para distribuir el saldo en créditos candidatos.
        // ========================================
        if (debeReinvertir) {
          try {
            console.log(`  🔄 Ejecutando reinversión automática por Q${montoReinvertido.toFixed(2)}...`);

            // Calcular mediana de porcentajes desde los créditos actuales del inversionista
            const creditosInv = await db
              .select({
                porcentaje_participacion_inversionista: creditos_inversionistas.porcentaje_participacion_inversionista,
                porcentaje_cash_in: creditos_inversionistas.porcentaje_cash_in,
              })
              .from(creditos_inversionistas)
              .where(eq(creditos_inversionistas.inversionista_id, inv_id));

            const moda = (arr: number[]) => {
              if (arr.length === 0) return 0;
              const freq = new Map<number, number>();
              for (const v of arr) freq.set(v, (freq.get(v) ?? 0) + 1);
              let maxFreq = 0, result = arr[0];
              for (const [val, count] of freq) {
                if (count > maxFreq) { maxFreq = count; result = val; }
              }
              return result;
            };

            const modaInversion = moda(creditosInv.map((c) => Number(c.porcentaje_participacion_inversionista)));
            const modaCashIn = moda(creditosInv.map((c) => Number(c.porcentaje_cash_in)));

            console.log(`  📊 Moda porcentaje inversión: ${modaInversion}%, cash in: ${modaCashIn}%`);

            const reinversionResult = await addInvestorToCredit({
              body: {
                inversionista_id: inv_id,
                monto_aportado: montoReinvertido.toNumber(),
                porcentaje_inversion: modaInversion,
                porcentaje_cash_in: modaCashIn,
                tipo_operacion: "reinversion",
              },
              set: { status: 200 },
            });

            console.log(`  ✅ Reinversión automática completada:`, reinversionResult);
          } catch (reinvError) {
            console.error(`  ❌ Error en reinversión automática (liquidación ya guardada):`, reinvError);
          }
        }
      } catch (excelError) {
        console.error(`  ❌ Error generando Excel (datos financieros ya guardados):`, excelError);
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
  console.log(`   - Excels generados: ${reportesGenerados.length}`);
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
  } catch (err) {
    // Marcar lock como FALLIDO con el error
    await db.update(liquidacion_locks)
      .set({ estado: "FALLIDO", finished_at: new Date(), error: err instanceof Error ? err.message : String(err) })
      .where(eq(liquidacion_locks.id, lock.id));
    throw err;
  } finally {
    // Marcar lock como COMPLETADO (si no falló)
    await db.update(liquidacion_locks)
      .set({ estado: "COMPLETADO", finished_at: new Date() })
      .where(
        and(
          eq(liquidacion_locks.id, lock.id),
          eq(liquidacion_locks.estado, "EN_PROCESO")
        )
      );
  }
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
    ${inversionista.reinversion === 'reinversion_combinada' ? (() => {
      // Agrupar créditos por tipo_reinversion
      const labelMap: Record<string, string> = {
        reinversion_capital: 'Reinversión Capital',
        reinversion_interes: 'Reinversión Interés',
        reinversion_total:   'Reinversión Total',
        sin_reinversion:     'Sin Reinversión',
      };

      // Orden fijo de grupos
      const grupos = ['reinversion_capital', 'reinversion_interes', 'reinversion_total', 'sin_reinversion', null];
      const tableHead = `
        <thead><tr>
          <th>Meses en crédito</th><th>Nombre</th><th>Capital</th>
          <th>% Interés</th><th>% Inversionista</th><th>Tasa interés inversor</th>
          <th>Interés Inversor</th><th>IVA</th><th>ISR</th>
          <th>Abono capital</th><th>% Inv. Neto</th><th>Capital restante</th>
          <th>Cuota de mes</th><th>Plazo</th><th>NIT</th>
        </tr></thead>`;

      return grupos.map(grupo => {
        const credGrupo = creditosData.filter(c => (c.tipo_reinversion ?? null) === grupo);
        if (credGrupo.length === 0) return '';

        const label = labelMap[grupo ?? ''] ?? 'Sin tipo definido';
        const colorBadge: Record<string, string> = {
          reinversion_capital: '#0485c2',
          reinversion_interes: '#16a34a',
          reinversion_total:   '#7c3aed',
          sin_reinversion:     '#64748b',
        };
        const badge = colorBadge[grupo ?? ''] ?? '#64748b';

        // Calcular subtotales del grupo
        let grpCapital = 0, grpInteres = 0, grpMontaAportado = 0;
        const rows = credGrupo.map(c => {
          // Sumar monto_aportado UNA SOLA VEZ por crédito, no por pago
          grpMontaAportado += Number(c.monto_aportado || 0);
          return (c.pagos && c.pagos.length > 0 ? c.pagos.map(pago => {
            grpCapital += Number(pago.abono_capital || 0);
            grpInteres += Number(pago.abonoGeneralInteres || 0);
            return `<tr>
              <td>${pago.cuota ?? c.meses_en_credito ?? ''}</td>
              <td>${c.nombre_usuario ?? ''}</td>
              <td>${fmt(Big(c.monto_aportado || 0).add(Big(pago.abono_capital || 0)).toFixed(2))}</td>
              <td>${c.porcentaje_interes ?? ''} %</td>
              <td>${pago.porcentaje_inversor ?? ''} %</td>
              <td>${Big(pago.tasaInteresInvesor || 0).div(100).toFixed(2)} %</td>
              <td>${fmt(pago.abono_interes)}</td>
              <td>${fmt(pago.abono_iva)}</td>
              <td>${fmt(pago.isr)}</td>
              <td>${fmt(pago.abono_capital)}</td>
              <td>${fmt(pago.abonoGeneralInteres)}</td>
              <td>${fmt(c.monto_aportado)}</td>
              <td>${pago.mes || '-'}${pago.cuota ? ` (Cuota #${pago.cuota})` : ''}</td>
              <td>${c.plazo ?? ''}</td>
              <td>${c.nit_usuario ?? ''}</td>
            </tr>`;
          }).join('') : '');
        }).join('');

        return `
          <div style="margin-top:20px;margin-bottom:10px;">
            <div style="display:inline-block;background:${badge};color:#fff;font-weight:700;font-size:1.1rem;padding:5px 18px;border-radius:20px;margin-bottom:10px;margin-left:50px;">
              ${label}
            </div>
            <div class="table-wrapper" style="margin-top:0;">
              <table>
                ${tableHead}
                <tbody>
                  ${rows}
                  <tr class="total">
                    <td>Total ${label}</td><td></td>
                    <td>${fmt(grpMontaAportado + grpCapital)}</td>
                    <td></td><td></td><td></td><td></td><td></td><td></td>
                    <td>${fmt(grpCapital)}</td>
                    <td>${fmt(grpInteres)}</td>
                    <td>${fmt(grpMontaAportado)}</td>
                    <td></td><td></td><td></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>`;
      }).join('');
    })() : `
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
    `}
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

export const fixCubeInvestment = async ({ set }: any) => {
  try {
    const CUBE_INVESTMENT_ID = 86;

    console.log(`🚀 Iniciando corrección para Cube Investment (ID: ${CUBE_INVESTMENT_ID})`);

    // 1. Obtener todos los créditos del inversionista en la tabla original
    const originalCredits = await db
      .select()
      .from(creditos_inversionistas)
      .where(eq(creditos_inversionistas.inversionista_id, CUBE_INVESTMENT_ID));

    // 2. Obtener todos los créditos del inversionista en la tabla espejo
    const mirrorCredits = await db
      .select()
      .from(creditos_inversionistas_espejo)
      .where(eq(creditos_inversionistas_espejo.inversionista_id, CUBE_INVESTMENT_ID));

    const mirrorCreditsMap = new Map(mirrorCredits.map((c) => [c.credito_id, c]));

    const results = {
      updatedOriginal: 0,
      updatedMirror: 0,
      createdMirror: 0,
    };

    // 3. Procesar originales
    for (const oc of originalCredits) {
      // Verificar si ya tiene los porcentajes correctos para evitar updates innecesarios
      const isCorrect = Number(oc.porcentaje_participacion_inversionista) === 0 && 
                        Number(oc.porcentaje_cash_in) === 100;

      if (!isCorrect) {
        // Actualizar porcentajes en original
        console.log(`📝 Corrigiendo porcentajes para crédito ${oc.credito_id} en tabla original`);
        await db
          .update(creditos_inversionistas)
          .set({
            porcentaje_participacion_inversionista: "0",
            porcentaje_cash_in: "100",
          })
          .where(eq(creditos_inversionistas.id, oc.id));
        results.updatedOriginal++;
      }

      // Verificar si existe en espejo
      if (!mirrorCreditsMap.has(oc.credito_id)) {
        // Crear en espejo si no existe
        console.log(`➕ Creando registro espejo faltante para crédito ${oc.credito_id}`);
        await db.insert(creditos_inversionistas_espejo).values({
          credito_id: oc.credito_id,
          inversionista_id: oc.inversionista_id,
          cuota_inversionista: oc.cuota_inversionista,
          porcentaje_participacion_inversionista: "0",
          monto_aportado: oc.monto_aportado,
          porcentaje_cash_in: "100",
          monto_inversionista: oc.monto_inversionista,
          monto_cash_in: oc.monto_cash_in,
          iva_inversionista: oc.iva_inversionista,
          iva_cash_in: oc.iva_cash_in,
          fecha_creacion: oc.fecha_creacion,
          fecha_inicio_participacion: oc.fecha_inicio_participacion,
        });
        results.createdMirror++;
      }
    }

    // 4. Procesar espejos existentes (para asegurar que todos tengan 0/100)
    for (const mc of mirrorCredits) {
      const isCorrect = Number(mc.porcentaje_participacion_inversionista) === 0 && 
                        Number(mc.porcentaje_cash_in) === 100;

      if (!isCorrect) {
        console.log(`📝 Corrigiendo porcentajes para crédito ${mc.credito_id} en tabla espejo`);
        await db
          .update(creditos_inversionistas_espejo)
          .set({
            porcentaje_participacion_inversionista: "0",
            porcentaje_cash_in: "100",
          })
          .where(eq(creditos_inversionistas_espejo.id, mc.id));
        results.updatedMirror++;
      }
    }

    console.log(`✅ Proceso finalizado. Originales: ${results.updatedOriginal}, Espejos actualizados: ${results.updatedMirror}, Espejos creados: ${results.createdMirror}`);

    set.status = 200;
    return {
      message: "Proceso completado para Cube Investment (ID: 86)",
      results,
    };
  } catch (error) {
    console.error("❌ Error en fixCubeInvestment:", error);
    set.status = 500;
    return { message: "Error fixing Cube Investment", error: String(error) };
  }
};

export const reconcileMirrorPercentages = async ({ set }: any) => {
  try {
    console.log("🚀 Iniciando RECONCILIACIÓN SELECTIVA de porcentajes espejo...");

    // 1. Obtener todos los registros originales con info completa
    const allOriginals = await db
      .select({
        id: creditos_inversionistas.id,
        inversionista_id: creditos_inversionistas.inversionista_id,
        inversionista_nombre: inversionistas.nombre,
        credito_id: creditos_inversionistas.credito_id,
        p_inversor: creditos_inversionistas.porcentaje_participacion_inversionista,
        p_cashin: creditos_inversionistas.porcentaje_cash_in,
        sifco: creditos.numero_credito_sifco,
        cliente: usuarios.nombre,
      })
      .from(creditos_inversionistas)
      .innerJoin(creditos, eq(creditos_inversionistas.credito_id, creditos.credito_id))
      .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .innerJoin(inversionistas, eq(creditos_inversionistas.inversionista_id, inversionistas.inversionista_id));

    const allMirrors = await db.select().from(creditos_inversionistas_espejo);

    // 2. Mapear espejos
    const mirrorMap = new Map();
    allMirrors.forEach((m) => {
      const key = `${m.inversionista_id}_${m.credito_id}`;
      mirrorMap.set(key, m);
    });

    const results = {
      totalOriginals: allOriginals.length,
      updatedSwappedCount: 0,
      updatedSwapped: [] as any[],      // ✅ Corregidos (Invertidos)
      discrepanciesOtherCount: 0,
      discrepanciesOther: [] as any[],    // 📉 Reportados pero NO actualizados
      missingMirrorsCount: 0,
      missingMirrors: [] as any[],       // ➕ Sin espejo (Solo reporte)
      unchangedMirrors: 0,
    };

    // 3. Procesar cada registro
    for (const oc of allOriginals) {
      const key = `${oc.inversionista_id}_${oc.credito_id}`;
      const mc = mirrorMap.get(key);

      if (mc) {
        const pInvOriginal = Number(oc.p_inversor);
        const pCashOriginal = Number(oc.p_cashin);
        
        const pInvMirror = Number(mc.porcentaje_participacion_inversionista);
        const pCashMirror = Number(mc.porcentaje_cash_in);

        if (pInvOriginal !== pInvMirror || pCashOriginal !== pCashMirror) {
          
          const isSwapped = pInvOriginal === pCashMirror && pCashOriginal === pInvMirror;

          const data = {
            inversionista_id: oc.inversionista_id,
            inversionista_nombre: oc.inversionista_nombre,
            credito_id: oc.credito_id,
            sifco: oc.sifco,
            cliente: oc.cliente,
            mirror_id: mc.id,
            original: { inversor: pInvOriginal, cashin: pCashOriginal },
            mirror: { inversor: pInvMirror, cashin: pCashMirror }
          };

          if (isSwapped) {
            // ✅ SOLO actualizamos si están invertidos
            console.log(`✅ Corrigiendo valores invertidos en espejo para ID ${mc.id}`);
            await db
              .update(creditos_inversionistas_espejo)
              .set({
                porcentaje_participacion_inversionista: oc.p_inversor,
                porcentaje_cash_in: oc.p_cashin,
              })
              .where(eq(creditos_inversionistas_espejo.id, mc.id));
            
            results.updatedSwappedCount++;
            results.updatedSwapped.push(data);
          } else {
            // 📈 Otros descuadres: SOLO reportamos según instrucción
            results.discrepanciesOtherCount++;
            results.discrepanciesOther.push(data);
          }
        } else {
          results.unchangedMirrors++;
        }
      } else {
        results.missingMirrorsCount++;
        results.missingMirrors.push({
          inversionista_id: oc.inversionista_id,
          inversionista_nombre: oc.inversionista_nombre,
          credito_id: oc.credito_id,
          sifco: oc.sifco,
          cliente: oc.cliente
        });
      }
    }

    console.log(`✅ Reconciliación finalizada. Actualizados (Swapped): ${results.updatedSwappedCount}, Otros descuadres: ${results.discrepanciesOtherCount}`);

    set.status = 200;
    return {
      success: true,
      message: "Proceso de corrección selectiva finalizado. Solo los valores invertidos fueron actualizados.",
      data: results
    };
  } catch (error) {
    console.error("❌ Error en reconcileMirrorPercentages:", error);
    set.status = 500;
    return { success: false, message: "Error en la reconciliación", error: String(error) };
  }
};

export const auditMirrorPercentages = async ({ set }: any) => {
  try {
    console.log("🔍 Iniciando AUDITORÍA de porcentajes espejo (Solo lectura)...");

    // 1. Obtener todos los registros originales con info de cliente, SIFCO e Inversionista
    const allOriginals = await db
      .select({
        id: creditos_inversionistas.id,
        inversionista_id: creditos_inversionistas.inversionista_id,
        inversionista_nombre: inversionistas.nombre,
        credito_id: creditos_inversionistas.credito_id,
        p_inversor: creditos_inversionistas.porcentaje_participacion_inversionista,
        p_cashin: creditos_inversionistas.porcentaje_cash_in,
        sifco: creditos.numero_credito_sifco,
        cliente: usuarios.nombre,
      })
      .from(creditos_inversionistas)
      .innerJoin(creditos, eq(creditos_inversionistas.credito_id, creditos.credito_id))
      .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .innerJoin(inversionistas, eq(creditos_inversionistas.inversionista_id, inversionistas.inversionista_id));

    const allMirrors = await db.select().from(creditos_inversionistas_espejo);

    // 2. Mapear espejos
    const mirrorMap = new Map();
    allMirrors.forEach((m) => {
      const key = `${m.inversionista_id}_${m.credito_id}`;
      mirrorMap.set(key, m);
    });

    const results = {
      totalOriginals: allOriginals.length,
      discrepanciesCount: 0,
      discrepanciesSwapped: [] as any[], // 🔄 Valores invertidos (80/20 vs 20/80)
      discrepanciesOther: [] as any[],   // 📉 Otros descuadres (ej. decimales)
      missingMirrorsCount: 0,
      missingMirrors: [] as any[],
      correctMirrorsCount: 0,
    };

    // 3. Auditar
    for (const oc of allOriginals) {
      const key = `${oc.inversionista_id}_${oc.credito_id}`;
      const mc = mirrorMap.get(key);

      if (mc) {
        const pInvOriginal = Number(oc.p_inversor);
        const pCashOriginal = Number(oc.p_cashin);
        
        const pInvMirror = Number(mc.porcentaje_participacion_inversionista);
        const pCashMirror = Number(mc.porcentaje_cash_in);

        if (pInvOriginal !== pInvMirror || pCashOriginal !== pCashMirror) {
          results.discrepanciesCount++;

          const isSwapped = pInvOriginal === pCashMirror && pCashOriginal === pInvMirror;
          
          const discrepancyData = {
            inversionista_id: oc.inversionista_id,
            inversionista_nombre: oc.inversionista_nombre,
            credito_id: oc.credito_id,
            sifco: oc.sifco,
            cliente: oc.cliente,
            mirror_id: mc.id,
            original: {
              inversor: pInvOriginal,
              cashin: pCashOriginal
            },
            mirror: {
              inversor: pInvMirror,
              cashin: pCashMirror
            }
          };

          if (isSwapped) {
            results.discrepanciesSwapped.push(discrepancyData);
          } else {
            results.discrepanciesOther.push(discrepancyData);
          }
        } else {
          results.correctMirrorsCount++;
        }
      } else {
        results.missingMirrorsCount++;
        results.missingMirrors.push({
          inversionista_id: oc.inversionista_id,
          inversionista_nombre: oc.inversionista_nombre,
          credito_id: oc.credito_id,
          sifco: oc.sifco,
          cliente: oc.cliente
        });
      }
    }

    console.log(`✅ Auditoría finalizada. Discrepancias: ${results.discrepanciesCount}, Faltantes: ${results.missingMirrorsCount}`);

    set.status = 200;
    return {
      success: true,
      message: "Auditoría de porcentajes espejo completada con información de clientes",
      data: results
    };
  } catch (error) {
    console.error("❌ Error en auditMirrorPercentages:", error);
    set.status = 500;
    return { success: false, message: "Error en la auditoría", error: String(error) };
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
  moneda: "quetzales" | "dolares";
  currencySymbol: string;
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
  total_abono_general_interes: number;
  total_a_recibir_sin_reinversion: number;
  total_reinversion: number;
  total_a_recibir_con_reinversion: number;
  total_cuota: number;
  boleta_pendiente: BoletaPendiente | null;
  boleta_liquidacion: BoletaPendiente | null;
  reporte_liquidacion_url: string | null;
  mes_liquidacion?: number | null;
  anio_liquidacion?: number | null;
}

type EstadoPagoResumen = "NO_LIQUIDADO" | "LIQUIDADO";

interface InversionistaResumenConEstado extends InversionistaResumen {
  estado_liquidacion_resumen: EstadoLiquidacionResumen;
}

interface InversionistaResumenRow {
  inversionista_id: number;
  nombre: string;
  moneda: "quetzales" | "dolares";
  emite_factura: boolean;
  reinversion:
    | "sin_reinversion"
    | "reinversion_capital"
    | "reinversion_interes"
    | "reinversion_total"
    | "reinversion_variable";
  banco_nombre: string | null;
  tipo_cuenta: string | null;
  numero_cuenta: string | null;
  total_abono_capital: number;
  total_abono_interes: number;
  total_abono_iva: number;
  total_isr: number;
  total_abono_general_interes: number;
  total_a_recibir_sin_reinversion: number;
  total_reinversion: number;
  total_a_recibir_con_reinversion: number;
  total_cuota: number;
  reporte_liquidacion_url?: string | null;
  mes_liquidacion?: number | null;
  anio_liquidacion?: number | null;
}

function mapBoletasPendientes(
  boletasPendientes: Array<{
    boleta_id: number;
    inversionista_id: number;
    boleta_url: string;
    estado: string;
    notas: string | null;
    monto_boleta: string | null;
    fecha_subida: Date;
  }>
) {
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

  return boletaMap;
}

async function getBoletasPendientesMap(
  inversionistaIds: number[],
  mes?: number,
  anio?: number
) {
  return getBoletasMap(inversionistaIds, ["PENDIENTE"], mes, anio);
}

async function getBoletasMap(
  inversionistaIds: number[],
  estados: Array<"PENDIENTE" | "PROCESADO">,
  mes?: number,
  anio?: number
) {
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
            inArray(boletasPagoInversionista.estado, estados),
            ...(mes
              ? [sql`EXTRACT(MONTH FROM ${boletasPagoInversionista.fecha_subida}) = ${mes}`]
              : []),
            ...(anio
              ? [sql`EXTRACT(YEAR FROM ${boletasPagoInversionista.fecha_subida}) = ${anio}`]
              : [])
          )
        )
        .orderBy(desc(boletasPagoInversionista.fecha_subida))
    : [];

  const boletasFiltradas = boletasPendientes.filter((boleta) =>
    boletaEstaEnPeriodo(boleta.fecha_subida, mes, anio)
  );

  return mapBoletasPendientes(boletasFiltradas);
}

async function getBoletasLiquidacionMap(
  inversionistaIds: number[],
  mes?: number,
  anio?: number
) {
  if (inversionistaIds.length === 0) {
    return new Map<number, BoletaPendiente>();
  }

  const liquidacionesConBoleta = await db
    .select({
      inversionista_id: liquidaciones.inversionista_id,
      boleta_id: boletasPagoInversionista.boleta_id,
      boleta_url: boletasPagoInversionista.boleta_url,
      estado: boletasPagoInversionista.estado,
      notas: boletasPagoInversionista.notas,
      monto_boleta: boletasPagoInversionista.monto_boleta,
      fecha_subida: boletasPagoInversionista.fecha_subida,
      fecha_liquidacion: liquidaciones.fecha_liquidacion,
    })
    .from(liquidaciones)
    .innerJoin(
      boletasPagoInversionista,
      eq(liquidaciones.boleta_id, boletasPagoInversionista.boleta_id)
    )
    .where(
      and(
        inArray(liquidaciones.inversionista_id, inversionistaIds),
        ...(mes
          ? [sql`EXTRACT(MONTH FROM ${liquidaciones.fecha_liquidacion}) = ${mes}`]
          : []),
        ...(anio
          ? [sql`EXTRACT(YEAR FROM ${liquidaciones.fecha_liquidacion}) = ${anio}`]
          : [])
      )
    )
    .orderBy(
      desc(liquidaciones.fecha_liquidacion),
      desc(boletasPagoInversionista.fecha_subida)
    );

  const boletaMap = new Map<number, BoletaPendiente>();

  for (const row of liquidacionesConBoleta) {
    if (!boletaMap.has(row.inversionista_id)) {
      boletaMap.set(row.inversionista_id, {
        boleta_id: row.boleta_id,
        boleta_url: row.boleta_url,
        estado: row.estado,
        notas: row.notas,
        monto_boleta: row.monto_boleta,
        fecha_subida: row.fecha_subida,
      });
    }
  }

  return boletaMap;
}

async function consultarResumenGlobalPorEstadoPago(
  estadoPago: EstadoPagoResumen,
  inversionistaId?: number,
  mes?: number,
  anio?: number,
  excel: boolean = false
): Promise<InversionistaResumenRow[]> {
  const condicionesWhere: any[] = [
    eq(inversionistas.permite_distribucion, false),
  ];

  if (inversionistaId) {
    condicionesWhere.push(eq(inversionistas.inversionista_id, inversionistaId));
  }

  const pe = pagos_credito_inversionistas_espejo;
  const ce = creditos_inversionistas_espejo;
  const condicionesJoinPagos: any[] = [
    eq(inversionistas.inversionista_id, pe.inversionista_id),
    eq(pe.estado_liquidacion, estadoPago),
  ];

  if (mes) {
    condicionesJoinPagos.push(sql`EXTRACT(MONTH FROM ${pe.fecha_pago}) = ${mes}`);
  }

  if (anio) {
    condicionesJoinPagos.push(sql`EXTRACT(YEAR FROM ${pe.fecha_pago}) = ${anio}`);
  }

  const selectObj: Record<string, any> = {
    inversionista_id: inversionistas.inversionista_id,
    nombre: inversionistas.nombre,
    moneda: inversionistas.moneda,
    emite_factura: inversionistas.emite_factura,
    reinversion: inversionistas.tipo_reinversion,
    banco_nombre: bancos.nombre,
    tipo_cuenta: inversionistas.tipo_cuenta,
    numero_cuenta: inversionistas.numero_cuenta,
    total_abono_capital: sql<number>`COALESCE(SUM(${pe.abono_capital}), 0)`,
    total_abono_interes: sql<number>`COALESCE(SUM(${pe.abono_interes}), 0)`,
    total_abono_iva: sql<number>`COALESCE(SUM(${pe.abono_iva_12}), 0)`,
    total_isr: sql<number>`COALESCE(SUM(
      CASE
        WHEN ${inversionistas.emite_factura} THEN 0
        ELSE ROUND(${pe.abono_interes} * 0.07, 2)
      END
    ), 0)`,
      total_abono_general_interes: sql<number>`COALESCE(SUM(
        ${pe.abono_interes}
        + CASE
            WHEN ${inversionistas.emite_factura}
              THEN ${pe.abono_iva_12}
            ELSE -ROUND(${pe.abono_interes} * 0.07, 2)
          END
      ), 0)`,
      total_a_recibir_sin_reinversion: sql<number>`COALESCE(SUM(
        ${pe.abono_capital}
        + ${pe.abono_interes}
        + CASE
            WHEN ${inversionistas.emite_factura}
              THEN ${pe.abono_iva_12}
            ELSE -ROUND(${pe.abono_interes} * 0.07, 2)
          END
      ), 0)`,
      total_reinversion: sql<number>`CASE ${inversionistas.tipo_reinversion}
        WHEN 'sin_reinversion' THEN 0
        WHEN 'reinversion_capital' THEN COALESCE(SUM(${pe.abono_capital}), 0)
        WHEN 'reinversion_interes' THEN COALESCE(SUM(
          ${pe.abono_interes}
          - CASE WHEN NOT ${inversionistas.emite_factura} THEN ROUND(${pe.abono_interes} * 0.07, 2) ELSE 0 END
        ), 0)
        WHEN 'reinversion_total' THEN COALESCE(SUM(
          ${pe.abono_capital} + ${pe.abono_interes}
          - CASE WHEN NOT ${inversionistas.emite_factura} THEN ROUND(${pe.abono_interes} * 0.07, 2) ELSE 0 END
        ), 0)
        WHEN 'reinversion_combinada' THEN COALESCE(SUM(
          CASE ${ce.tipo_reinversion}
            WHEN 'reinversion_capital' THEN ${pe.abono_capital}
            WHEN 'reinversion_interes' THEN ${pe.abono_interes}
              - CASE WHEN NOT ${inversionistas.emite_factura} THEN ROUND(${pe.abono_interes} * 0.07, 2) ELSE 0 END
            WHEN 'reinversion_total' THEN ${pe.abono_capital} + ${pe.abono_interes}
              - CASE WHEN NOT ${inversionistas.emite_factura} THEN ROUND(${pe.abono_interes} * 0.07, 2) ELSE 0 END
            ELSE 0
          END
        ), 0)
        WHEN 'reinversion_variable' THEN LEAST(
          COALESCE(${inversionistas.monto_reinversion}, 0)::numeric,
          COALESCE(SUM(
            ${pe.abono_capital}
            + ${pe.abono_interes}
            + CASE
                WHEN ${inversionistas.emite_factura}
                  THEN ${pe.abono_iva_12}
                ELSE -ROUND(${pe.abono_interes} * 0.07, 2)
              END
          ), 0)
        )
        ELSE 0
      END`,
      total_a_recibir_con_reinversion: sql<number>`
        COALESCE(SUM(
          ${pe.abono_capital}
          + ${pe.abono_interes}
          + CASE
              WHEN ${inversionistas.emite_factura}
                THEN ${pe.abono_iva_12}
              ELSE -ROUND(${pe.abono_interes} * 0.07, 2)
            END
        ), 0)
        - CASE ${inversionistas.tipo_reinversion}
            WHEN 'sin_reinversion' THEN 0
            WHEN 'reinversion_capital' THEN COALESCE(SUM(${pe.abono_capital}), 0)
            WHEN 'reinversion_interes' THEN COALESCE(SUM(
              ${pe.abono_interes}
              - CASE WHEN NOT ${inversionistas.emite_factura} THEN ROUND(${pe.abono_interes} * 0.07, 2) ELSE 0 END
            ), 0)
            WHEN 'reinversion_total' THEN COALESCE(SUM(
              ${pe.abono_capital} + ${pe.abono_interes}
              - CASE WHEN NOT ${inversionistas.emite_factura} THEN ROUND(${pe.abono_interes} * 0.07, 2) ELSE 0 END
            ), 0)
            WHEN 'reinversion_combinada' THEN COALESCE(SUM(
              CASE ${ce.tipo_reinversion}
                WHEN 'reinversion_capital' THEN ${pe.abono_capital}
                WHEN 'reinversion_interes' THEN ${pe.abono_interes}
                  - CASE WHEN NOT ${inversionistas.emite_factura} THEN ROUND(${pe.abono_interes} * 0.07, 2) ELSE 0 END
                WHEN 'reinversion_total' THEN ${pe.abono_capital} + ${pe.abono_interes}
                  - CASE WHEN NOT ${inversionistas.emite_factura} THEN ROUND(${pe.abono_interes} * 0.07, 2) ELSE 0 END
                ELSE 0
              END
            ), 0)
            WHEN 'reinversion_variable' THEN LEAST(
              COALESCE(${inversionistas.monto_reinversion}, 0)::numeric,
              COALESCE(SUM(
                ${pe.abono_capital}
                + ${pe.abono_interes}
                + CASE
                    WHEN ${inversionistas.emite_factura}
                      THEN ${pe.abono_iva_12}
                    ELSE -ROUND(${pe.abono_interes} * 0.07, 2)
                  END
              ), 0)
            )
            ELSE 0
          END`,
      total_cuota: sql<number>`CASE ${inversionistas.tipo_reinversion}
        WHEN 'sin_reinversion' THEN COALESCE(SUM(
          ${pe.abono_capital}
          + ${pe.abono_interes}
          + CASE
              WHEN ${inversionistas.emite_factura}
                THEN ${pe.abono_iva_12}
              ELSE -ROUND(${pe.abono_interes} * 0.07, 2)
            END
        ), 0)
        WHEN 'reinversion_capital' THEN COALESCE(SUM(
          ${pe.abono_interes}
          + CASE
              WHEN ${inversionistas.emite_factura}
                THEN ${pe.abono_iva_12}
              ELSE -ROUND(${pe.abono_interes} * 0.07, 2)
            END
        ), 0)
        WHEN 'reinversion_interes' THEN COALESCE(SUM(
          ${pe.abono_capital}
          + CASE
              WHEN ${inversionistas.emite_factura}
                THEN ${pe.abono_iva_12}
              ELSE -ROUND(${pe.abono_interes} * 0.07, 2)
            END
        ), 0)
        WHEN 'reinversion_total' THEN 0
        WHEN 'reinversion_combinada' THEN COALESCE(SUM(
          CASE ${ce.tipo_reinversion}
            WHEN 'reinversion_total' THEN 0
            WHEN 'reinversion_capital' THEN (
              ${pe.abono_interes} + CASE WHEN ${inversionistas.emite_factura} THEN ${pe.abono_iva_12} ELSE -ROUND(${pe.abono_interes} * 0.07, 2) END
            )
            WHEN 'reinversion_interes' THEN (
              ${pe.abono_capital} + CASE WHEN ${inversionistas.emite_factura} THEN ${pe.abono_iva_12} ELSE -ROUND(${pe.abono_interes} * 0.07, 2) END
            )
            ELSE (
               ${pe.abono_capital} + ${pe.abono_interes} + CASE WHEN ${inversionistas.emite_factura} THEN ${pe.abono_iva_12} ELSE -ROUND(${pe.abono_interes} * 0.07, 2) END
            )
          END
        ), 0)
        WHEN 'reinversion_variable' THEN
          COALESCE(SUM(
            ${pe.abono_capital}
            + ${pe.abono_interes}
            + CASE
                WHEN ${inversionistas.emite_factura}
                  THEN ${pe.abono_iva_12}
                ELSE -ROUND(${pe.abono_interes} * 0.07, 2)
              END
          ), 0)
          - LEAST(
              COALESCE(${inversionistas.monto_reinversion}, 0)::numeric,
              COALESCE(SUM(
                ${pe.abono_capital}
                + ${pe.abono_interes}
                + CASE
                    WHEN ${inversionistas.emite_factura}
                      THEN ${pe.abono_iva_12}
                    ELSE -ROUND(${pe.abono_interes} * 0.07, 2)
                  END
              ), 0)
            )
        ELSE COALESCE(SUM(
          ${pe.abono_capital}
          + ${pe.abono_interes}
          + CASE
              WHEN ${inversionistas.emite_factura}
                THEN ${pe.abono_iva_12}
              ELSE -ROUND(${pe.abono_interes} * 0.07, 2)
            END
        ), 0)
      END`,
  };

  // Si no hay filtro de mes/anio, agrupar por mes para obtener un registro por período
  const agruparPorMes = !mes && !anio;
  if (agruparPorMes) {
    selectObj.mes_liquidacion = sql<number>`EXTRACT(MONTH FROM ${pe.fecha_pago})::int`;
    selectObj.anio_liquidacion = sql<number>`EXTRACT(YEAR FROM ${pe.fecha_pago})::int`;
  }

  const groupByFields = [
    inversionistas.inversionista_id,
    inversionistas.nombre,
    inversionistas.moneda,
    inversionistas.emite_factura,
    inversionistas.tipo_reinversion,
    inversionistas.monto_reinversion,
    bancos.nombre,
    inversionistas.tipo_cuenta,
    inversionistas.numero_cuenta,
  ];

  if (agruparPorMes) {
    groupByFields.push(
      sql`EXTRACT(MONTH FROM ${pe.fecha_pago})` as any,
      sql`EXTRACT(YEAR FROM ${pe.fecha_pago})` as any,
    );
  }

  const result = await db
    .select(selectObj as any)
    .from(inversionistas)
    .leftJoin(bancos, eq(inversionistas.banco_id, bancos.banco_id))
    .leftJoin(pe, and(...condicionesJoinPagos))
    .leftJoin(ce, and(eq(pe.credito_id, ce.credito_id), eq(pe.inversionista_id, ce.inversionista_id)))
    .where(and(...condicionesWhere))
    .groupBy(...groupByFields)
    .having(excel ? undefined : sql`COUNT(${pe.id}) > 0`);

  return result as unknown as InversionistaResumenRow[];
}

async function consultarResumenGlobalDesdeLiquidaciones(
  inversionistaId?: number,
  mes?: number,
  anio?: number
): Promise<InversionistaResumenRow[]> {
  const condicionesWhere: any[] = [
    eq(inversionistas.permite_distribucion, false),
  ];

  if (inversionistaId) {
    condicionesWhere.push(eq(inversionistas.inversionista_id, inversionistaId));
  }

  if (mes) {
    condicionesWhere.push(sql`EXTRACT(MONTH FROM ${liquidaciones.fecha_liquidacion}) = ${mes}`);
  }

  if (anio) {
    condicionesWhere.push(sql`EXTRACT(YEAR FROM ${liquidaciones.fecha_liquidacion}) = ${anio}`);
  }

  // Si no hay filtro de mes/anio, agrupar por mes para obtener un registro por período
  const agruparPorMes = !mes && !anio;

  const selectFields: Record<string, any> = {
    inversionista_id: inversionistas.inversionista_id,
    nombre: inversionistas.nombre,
    moneda: inversionistas.moneda,
    emite_factura: inversionistas.emite_factura,
    reinversion: inversionistas.tipo_reinversion,
    banco_nombre: bancos.nombre,
    tipo_cuenta: inversionistas.tipo_cuenta,
    numero_cuenta: inversionistas.numero_cuenta,
    total_abono_capital: sql<number>`COALESCE(SUM(${liquidaciones.total_capital}), 0)`,
    total_abono_interes: sql<number>`COALESCE(SUM(${liquidaciones.total_interes}), 0)`,
    total_abono_iva: sql<number>`COALESCE(SUM(${liquidaciones.total_iva}), 0)`,
    total_isr: sql<number>`COALESCE(SUM(${liquidaciones.total_isr}), 0)`,
    total_abono_general_interes: sql<number>`COALESCE(SUM(${liquidaciones.total_interes} + ${liquidaciones.total_iva} - ${liquidaciones.total_isr}), 0)`,
    total_reinversion: sql<number>`COALESCE(SUM(${liquidaciones.reinversion_total}), 0)`,
    total_cuota: sql<number>`COALESCE(SUM(${liquidaciones.total_cuota}), 0)`,
    total_a_recibir_con_reinversion: sql<number>`COALESCE(SUM(${liquidaciones.total_cuota}), 0)`,
    total_a_recibir_sin_reinversion: sql<number>`COALESCE(SUM(${liquidaciones.total_cuota}), 0) + COALESCE(SUM(${liquidaciones.reinversion_total}), 0)`,
    reporte_liquidacion_url: sql<string | null>`MAX(${liquidaciones.reporte_liquidacion_url})`,
  };

  if (agruparPorMes) {
    selectFields.mes_liquidacion = sql<number>`EXTRACT(MONTH FROM ${liquidaciones.fecha_liquidacion})::int`;
    selectFields.anio_liquidacion = sql<number>`EXTRACT(YEAR FROM ${liquidaciones.fecha_liquidacion})::int`;
  }

  const groupByFields = [
    inversionistas.inversionista_id,
    inversionistas.nombre,
    inversionistas.moneda,
    inversionistas.emite_factura,
    inversionistas.tipo_reinversion,
    bancos.nombre,
    inversionistas.tipo_cuenta,
    inversionistas.numero_cuenta,
  ];

  if (agruparPorMes) {
    groupByFields.push(
      sql`EXTRACT(MONTH FROM ${liquidaciones.fecha_liquidacion})` as any,
      sql`EXTRACT(YEAR FROM ${liquidaciones.fecha_liquidacion})` as any,
    );
  }

  const result = await db
    .select(selectFields as any)
    .from(liquidaciones)
    .innerJoin(
      inversionistas,
      eq(liquidaciones.inversionista_id, inversionistas.inversionista_id)
    )
    .leftJoin(bancos, eq(inversionistas.banco_id, bancos.banco_id))
    .where(and(...condicionesWhere))
    .groupBy(...groupByFields);

  return result as unknown as InversionistaResumenRow[];
}

function mapResumenRow(
  inv: InversionistaResumenRow,
  boleta_pendiente: BoletaPendiente | null,
  boleta_liquidacion: BoletaPendiente | null = null
): InversionistaResumen {
  const isUSD = inv.moneda === "dolares";
  const currencySymbol = isUSD ? "$" : "Q";

  const convert = (val: number | string | null | undefined): number => {
    if (!isUSD) return Number(val || 0);
    return formatToUSD(val, inv.inversionista_id);
  };

  return {
    inversionista_id: inv.inversionista_id,
    nombre: inv.nombre,
    moneda: inv.moneda,
    currencySymbol,
    emite_factura: inv.emite_factura,
    reinversion: inv.reinversion,
    banco: inv.banco_nombre,
    tipo_cuenta: inv.tipo_cuenta,
    numero_cuenta: inv.numero_cuenta,
    total_abono_capital: convert(inv.total_abono_capital),
    total_abono_interes: convert(inv.total_abono_interes),
    total_abono_iva: convert(inv.total_abono_iva),
    total_isr: convert(inv.total_isr),
    total_abono_general_interes: convert(inv.total_abono_general_interes),
    total_a_recibir_sin_reinversion: convert(inv.total_a_recibir_sin_reinversion),
    total_reinversion: convert(inv.total_reinversion),
    total_a_recibir_con_reinversion: convert(inv.total_a_recibir_con_reinversion),
    total_cuota: convert(inv.total_cuota),
    boleta_pendiente,
    boleta_liquidacion,
    reporte_liquidacion_url: inv.reporte_liquidacion_url ?? null,
    ...(inv.mes_liquidacion != null ? { mes_liquidacion: inv.mes_liquidacion } : {}),
    ...(inv.anio_liquidacion != null ? { anio_liquidacion: inv.anio_liquidacion } : {}),
  };
}

async function generateResumenGlobalWorkbook(
  rows: Array<InversionistaResumen | InversionistaResumenConEstado>,
  includeEstado: boolean
) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Resumen Inversionistas");

  const headers = [
    "ID",
    "Nombre",
    ...(includeEstado ? ["Estado"] : []),
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
    "Cuota",
  ];

  const headerRow = sheet.addRow(headers);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0070C0" },
  };
  headerRow.alignment = { horizontal: "center", vertical: "middle" };

  // Header de "Cuota" resaltado en verde
  const cuotaHeaderCell = headerRow.getCell(headers.length);
  cuotaHeaderCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF00B050" },
  };
  cuotaHeaderCell.font = { bold: true, color: { argb: "FFFFFFFF" } };

  rows.forEach((inv) => {
    const row = sheet.addRow([
      inv.inversionista_id,
      inv.nombre,
      ...("estado_liquidacion_resumen" in inv ? [inv.estado_liquidacion_resumen] : includeEstado ? [""] : []),
      inv.emite_factura ? "Sí" : "No",
      inv.reinversion || "sin_reinversion",
      inv.banco ?? "",
      inv.tipo_cuenta ?? "",
      inv.numero_cuenta ?? "",
      Number(inv.total_abono_capital).toFixed(2),
      Number(inv.total_abono_interes).toFixed(2),
      Number(inv.total_abono_iva).toFixed(2),
      Number(inv.total_isr).toFixed(2),
      Number(inv.total_a_recibir_sin_reinversion).toFixed(2),
      Number(inv.total_reinversion).toFixed(2),
      Number(inv.total_a_recibir_con_reinversion).toFixed(2),
      Number(inv.total_cuota).toFixed(2),
    ]);

    const isrCellIndex = includeEstado ? 12 : 11;
    const firstMoneyColumn = includeEstado ? 9 : 8;
    const lastMoneyColumn = includeEstado ? 16 : 15;

    if (inv.emite_factura) {
      const isrCell = row.getCell(isrCellIndex);
      isrCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFE0E0E0" },
      };
      isrCell.font = { color: { argb: "FF808080" } };
    }

    for (let i = firstMoneyColumn; i <= lastMoneyColumn; i++) {
      row.getCell(i).numFmt = "Q#,##0.00";
    }

    // Resaltar columna "Cuota" (última columna) en verde
    const cuotaCell = row.getCell(lastMoneyColumn);
    cuotaCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF92D050" },
    };
    cuotaCell.font = { bold: true };
  });

  sheet.columns.forEach((col) => {
    let maxLength = 10;
    col.eachCell?.({ includeEmpty: true }, (cell) => {
      const len = cell.value ? cell.value.toString().length : 0;
      if (len > maxLength) maxLength = len;
    });
    col.width = maxLength + 2;
  });

  sheet.views = [{ state: "frozen", ySplit: 1 }];

  const buffer = await workbook.xlsx.writeBuffer();
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

  return {
    success: true,
    url: `${process.env.URL_PUBLIC_R2_REPORTS}/${filename}`,
    filename,
  };
}

export async function resumenGlobalInversionistas(
  inversionistaId?: number,
  mes?: number,
  anio?: number,
  excel: boolean = false
): Promise<
  InversionistaResumen[] | { success: boolean; url: string; filename: string }
> {
  const result = await consultarResumenGlobalPorEstadoPago(
    "NO_LIQUIDADO",
    inversionistaId,
    mes,
    anio,
    excel
  );

  console.log("resumen-global result IDs:", result.map(r => r.inversionista_id));
  console.log("resumen-global total:", result.length, "inversionistas");

  if (excel) {
    const excelRows = result.map((inv) => mapResumenRow(inv, null, null));
    return generateResumenGlobalWorkbook(excelRows, false);
  }

  const inversionistaIds = result.map((inv) => inv.inversionista_id);
  const boletaMap = await getBoletasPendientesMap(inversionistaIds);

  return result.map((inv) =>
    mapResumenRow(inv, boletaMap.get(inv.inversionista_id) ?? null, null)
  );
}

export async function resumenGlobalLiquidaciones(
  inversionistaId?: number,
  mes?: number,
  anio?: number,
  estado: EstadoLiquidacionResumenFilter = "pending",
  excel: boolean = false
): Promise<
  InversionistaResumenConEstado[] | { success: boolean; url: string; filename: string }
> {
  // Para este endpoint el período se recibe validado desde la ruta.
  // Cuando estado=all, el mes/anio aplican a todo el corte consultado.
  const [noLiquidados, liquidados] = await Promise.all([
    consultarResumenGlobalPorEstadoPago("NO_LIQUIDADO", inversionistaId, mes, anio, false),
    consultarResumenGlobalDesdeLiquidaciones(inversionistaId, mes, anio),
  ]);

  const inversionistaIds = Array.from(
    new Set([
      ...noLiquidados.map((inv) => inv.inversionista_id),
      ...liquidados.map((inv) => inv.inversionista_id),
    ])
  );
  const [boletaPendienteMap, boletaSubidaMap, boletaLiquidacionMap] = await Promise.all([
    getBoletasPendientesMap(inversionistaIds, mes, anio),
    getBoletasMap(inversionistaIds, ["PENDIENTE", "PROCESADO"], mes, anio),
    getBoletasLiquidacionMap(inversionistaIds, mes, anio),
  ]);

  const result: InversionistaResumenConEstado[] = [];

  for (const inv of noLiquidados) {
    const hasBoletaSubida = boletaSubidaMap.has(inv.inversionista_id);
    const estadoResumen = resolveEstadoLiquidacionResumen({
      requestedEstado: estado,
      hasNoLiquidado: true,
      hasLiquidado: false, // 🆕 Forzamos false para que el primer loop solo genere estados pendientes/subidos
      hasBoletaPendiente: hasBoletaSubida,
    });

    if (!estadoResumen) {
      continue;
    }

    result.push({
      ...mapResumenRow(
        inv,
        boletaPendienteMap.get(inv.inversionista_id) ?? null,
        boletaLiquidacionMap.get(inv.inversionista_id) ?? null
      ),
      estado_liquidacion_resumen: estadoResumen,
    });
  }

  for (const inv of liquidados) {
    const estadoResumen = resolveEstadoLiquidacionResumen({
      requestedEstado: estado,
      hasNoLiquidado: false,
      hasLiquidado: true,
      hasBoletaPendiente: false,
    });

    if (!estadoResumen) {
      continue;
    }

    result.push({
      ...mapResumenRow(
        inv,
        null,
        boletaLiquidacionMap.get(inv.inversionista_id) ?? null
      ),
      estado_liquidacion_resumen: estadoResumen,
    });
  }

  console.log("resumen-global-liquidaciones estado:", estado);
  console.log(
    "resumen-global-liquidaciones total:",
    result.length,
    "inversionistas"
  );

  if (excel) {
    return generateResumenGlobalWorkbook(result, true);
  }

  return result;
}

export const isNullorEmpty = (value: string | number | null | undefined): value is null | undefined | "" => {
  return value === null || value === undefined || value === "";
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

   if (!isNullorEmpty(email)) {
    conditions.push(eq(inversionistas.email, email));
  } else if (!isNullorEmpty(dpi)) {
    conditions.push(eq(inversionistas.dpi, parseInt(dpi)));
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
      moneda: inversionistas.moneda,
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

      // Formateo sensible a moneda del inversionista
      const formatValue = (val: string | number) =>
        liq.moneda === "dolares" ? formatToUSD(val, liq.inversionista_id) : Number(val);
      const currencySymbol = liq.moneda === "dolares" ? "$" : "Q.";

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
          abono_capital: formatValue(abono_capital.toString()),
          abono_interes: formatValue(abono_interes.toString()),
          abono_iva: formatValue(abono_iva.toString()),
          isr: formatValue(isr.toString()),
          cuota: formatValue(cuota.toString()),
        };
      });

      return {
        liquidacion_id: liq.liquidacion_id,
        inversionista_id: liq.inversionista_id,
        nombre_inversionista: liq.nombre_inversionista ?? "TODOS",
        emite_factura: liq.emite_factura,
        dpi: liq.dpi,
        moneda: liq.moneda,
        currencySymbol,

        // 🔥 BOLETA ASOCIADA
        boleta: boletaData,

        totales: {
          total_pagos_liquidados: liq.total_pagos_liquidados,
          total_capital: formatValue(liq.total_capital),
          total_interes: formatValue(liq.total_interes),
          total_iva: formatValue(liq.total_iva),
          total_isr: formatValue(liq.total_isr),
          total_cuota: formatValue(liq.total_cuota),
        },
        reinversion: {
          reinversion_capital: formatValue(liq.reinversion_capital),
          reinversion_interes: formatValue(liq.reinversion_interes),
          reinversion_total: formatValue(liq.reinversion_total),
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
export async function getInvestorPerformance(dpi?: string, email?: string) {
  if (!dpi && !email) {
    throw new Error("Se requiere al menos 'dpi' o 'email'");
  }

  // 1️⃣ Buscar inversionista (Prioridad: Email > DPI)
  const whereClause = email
    ? eq(inversionistas.email, email)
    : eq(inversionistas.dpi, parseInt(dpi!));

  const [inversionista] = await db
    .select({
      inversionista_id: inversionistas.inversionista_id,
      nombre: inversionistas.nombre,
      dpi: inversionistas.dpi,
    })
    .from(inversionistas)
    .where(whereClause)
    .limit(1);

  if (!inversionista) {
    throw new Error(`No se encontró inversionista con ${dpi ? 'DPI: ' + dpi : 'email: ' + email}`);
  }

  // 2️⃣ Obtener totales de inversiones de forma agregada
  const [totalesInversion] = await db
    .select({
      capital_total: sql<string>`coalesce(sum(${creditos_inversionistas_espejo.monto_aportado}), 0)`,
      cantidad: count(),
    })
    .from(creditos_inversionistas_espejo)
    .where(eq(creditos_inversionistas_espejo.inversionista_id, inversionista.inversionista_id));

  // 3️⃣ Obtener total de rendimiento (intereses liquidados * 1.2) de forma agregada
  const [totalesRendimiento] = await db
    .select({
      interes_total: sql<string>`coalesce(sum(${pagos_credito_inversionistas_espejo.abono_interes}), 0)`,
    })
    .from(pagos_credito_inversionistas_espejo)
    .where(
      and(
        eq(pagos_credito_inversionistas_espejo.inversionista_id, inversionista.inversionista_id),
        eq(pagos_credito_inversionistas_espejo.estado_liquidacion, "LIQUIDADO")
      )
    );

  const capitalOpt = new Big(totalesInversion.capital_total || 0);
  const rendimientoOpt = new Big(totalesRendimiento.interes_total || 0).times(1.2);

  return {
    inversionista_id: inversionista.inversionista_id,
    nombre: inversionista.nombre,
    dpi: inversionista.dpi?.toString(),
    capital_total_aportado: Number(capitalOpt.toFixed(2)),
    cantidad_inversiones: totalesInversion.cantidad,
    rendimiento_estimado: Number(rendimientoOpt.toFixed(2)),
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
          updated_at: new Date(),
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
        date: dayjs().format("MMMM YYYY"),
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

// ============================================
// GET CREDITOS ESPEJO PENDIENTES AGRUPADOS POR INVERSIONISTA
// ============================================

/**
 * Obtiene los créditos espejo en estado pendiente (pendiente_reinversion | pendiente_compra_cartera)
 * agrupados por inversionista. Incluye un array `otrosCreditos` placeholder (5 créditos random)
 * que será reemplazado por la consulta real cuando esté lista.
 */
export async function getCreditosEspejoPendientes(page: number = 1, pageSize: number = 10, search?: string) {
  // 1. Créditos espejo pendientes con info del inversionista + crédito + usuario
  const pendientes = await db
    .select({
      id: creditos_inversionistas_espejo.id,
      credito_id: creditos_inversionistas_espejo.credito_id,
      inversionista_id: creditos_inversionistas_espejo.inversionista_id,
      cuota_inversionista: creditos_inversionistas_espejo.cuota_inversionista,
      porcentaje_participacion_inversionista: creditos_inversionistas_espejo.porcentaje_participacion_inversionista,
      monto_aportado: creditos_inversionistas_espejo.monto_aportado,
      porcentaje_cash_in: creditos_inversionistas_espejo.porcentaje_cash_in,
      monto_inversionista: creditos_inversionistas_espejo.monto_inversionista,
      monto_cash_in: creditos_inversionistas_espejo.monto_cash_in,
      iva_inversionista: creditos_inversionistas_espejo.iva_inversionista,
      iva_cash_in: creditos_inversionistas_espejo.iva_cash_in,
      fecha_creacion: creditos_inversionistas_espejo.fecha_creacion,
      fecha_inicio_participacion: creditos_inversionistas_espejo.fecha_inicio_participacion,
      status: creditos_inversionistas_espejo.status,
      tipo_reinversion: creditos_inversionistas_espejo.tipo_reinversion,
      // Info del crédito
      numero_credito_sifco: creditos.numero_credito_sifco,
      nombre_usuario: usuarios.nombre,
      // Info inversionista (solo para agrupar, no se incluye en creditosPendientes)
      _nombre_inversionista: inversionistas.nombre,
      _dpi: inversionistas.dpi,
      _email: inversionistas.email,
      _moneda: inversionistas.moneda,
    })
    .from(creditos_inversionistas_espejo)
    .innerJoin(
      inversionistas,
      eq(creditos_inversionistas_espejo.inversionista_id, inversionistas.inversionista_id)
    )
    .innerJoin(
      creditos,
      eq(creditos_inversionistas_espejo.credito_id, creditos.credito_id)
    )
    .innerJoin(
      usuarios,
      eq(creditos.usuario_id, usuarios.usuario_id)
    )
    .where(
      sql`${creditos_inversionistas_espejo.status} IN ('pendiente_reinversion', 'pendiente_compra_cartera')`
    );

  if (pendientes.length === 0) {
    return { data: [], total: 0, page, pageSize };
  }

  // 2. Agrupar por inversionista
  type CreditoSinInversionista = Omit<typeof pendientes[number], '_nombre_inversionista' | '_dpi' | '_email' | '_moneda'> & {
    otrosInversionistas: { nombre: string; monto_aportado: string }[];
  };

  const agrupado = new Map<number, {
    inversionista_id: number;
    nombre: string;
    dpi: number | null;
    email: string | null;
    moneda: string;
    monto_reinversion: number;
    creditosPendientes: CreditoSinInversionista[];
  }>();

  // 2.1 Obtener todos los inversionistas de los mismos créditos (sin importar status)
  const creditoIds = [...new Set(pendientes.map((r) => r.credito_id))];

  const otrosInversionistasRaw = creditoIds.length > 0
    ? await db
        .select({
          credito_id: creditos_inversionistas_espejo.credito_id,
          inversionista_id: creditos_inversionistas_espejo.inversionista_id,
          nombre: inversionistas.nombre,
          monto_aportado: creditos_inversionistas_espejo.monto_aportado,
        })
        .from(creditos_inversionistas_espejo)
        .innerJoin(
          inversionistas,
          eq(creditos_inversionistas_espejo.inversionista_id, inversionistas.inversionista_id)
        )
        .where(inArray(creditos_inversionistas_espejo.credito_id, creditoIds))
    : [];

  // Agrupar otros inversionistas por credito_id para lookup rápido
  const otrosPorCredito = new Map<number, { inversionista_id: number; nombre: string; monto_aportado: string }[]>();
  for (const otro of otrosInversionistasRaw) {
    if (!otrosPorCredito.has(otro.credito_id)) {
      otrosPorCredito.set(otro.credito_id, []);
    }
    otrosPorCredito.get(otro.credito_id)!.push({
      inversionista_id: otro.inversionista_id,
      nombre: otro.nombre,
      monto_aportado: otro.monto_aportado,
    });
  }

  for (const row of pendientes) {
    const { _nombre_inversionista, _dpi, _email, _moneda, ...creditoData } = row;
    if (!agrupado.has(row.inversionista_id)) {
      agrupado.set(row.inversionista_id, {
        inversionista_id: row.inversionista_id,
        nombre: _nombre_inversionista,
        dpi: _dpi,
        email: _email,
        moneda: _moneda,
        monto_reinversion: 0,
        creditosPendientes: [],
      });
    }
    const grupo = agrupado.get(row.inversionista_id)!;
    grupo.monto_reinversion += parseFloat(creditoData.monto_aportado);

    // Filtrar al inversionista actual y adjuntar los demás
    const otrosEnEsteCredito = (otrosPorCredito.get(row.credito_id) || [])
      .filter((o) => o.inversionista_id !== row.inversionista_id);

    grupo.creditosPendientes.push({
      ...creditoData,
      otrosInversionistas: otrosEnEsteCredito.map((o) => ({
        nombre: o.nombre,
        monto_aportado: o.monto_aportado,
      })),
    });
  }

  let todos = Array.from(agrupado.values());

  if (search) {
    const term = search.toLowerCase();
    todos = todos.filter((inv) => inv.nombre.toLowerCase().includes(term));
  }

  const total = todos.length;

  // 3. Paginar
  const start = (page - 1) * pageSize;
  const paginados = todos.slice(start, start + pageSize);

  return { data: paginados, total, page, pageSize };
}

