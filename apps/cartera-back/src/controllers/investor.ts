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
import { eq, and, or, sql, inArray, ilike, like, desc, count, SQL, isNull, isNotNull, ne } from "drizzle-orm";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import Big from "big.js";
import { sendLiquidationEmail, sendPlainEmail, sendSimpleEmail } from "@cci/email";
import jwt from "jsonwebtoken";

const JWT_SECRET = process.env.JWT_SECRET || "supersecreto";

import { INVESTOR_STATUS_CHANGE_RECIPIENTS } from "../utils/functions/investorStatusRecipients";
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
      const isStrictCreate = inv.operation === "CREATE" || inv.mode === "create";
      let existente = null;

      // Buscar por inversionista_id primero (para ediciones directas)
      if (inv.inversionista_id) {
        const result = await db
          .select()
          .from(inversionistas)
          .where(eq(inversionistas.inversionista_id, Number(inv.inversionista_id)))
          .limit(1);
        existente = result[0] || null;

        if (!existente) {
          set.status = 404;
          return {
            message: "Inversionista no encontrado",
            error: "investor_not_found",
          };
        }
      }

      if (!existente && isStrictCreate) {
        if (inv.email?.trim()) {
          const email = inv.email.trim().toLowerCase();
          const result = await db
            .select()
            .from(inversionistas)
            .where(ilike(inversionistas.email, email))
            .limit(1);

          if (result[0]) {
            set.status = 409;
            return {
              message: "Ya existe un inversionista con ese email",
              error: "duplicate_email",
            };
          }
        }

        if (inv.dpi) {
          const result = await db
            .select()
            .from(inversionistas)
            .where(eq(inversionistas.dpi, inv.dpi))
            .limit(1);

          if (result[0]) {
            set.status = 409;
            return {
              message: "Ya existe un inversionista con ese DPI",
              error: "duplicate_dpi",
            };
          }
        }

        if (inv.nombre?.trim()) {
          const result = await db
            .select()
            .from(inversionistas)
            .where(eq(inversionistas.nombre, inv.nombre.trim()))
            .limit(1);

          if (result[0]) {
            set.status = 409;
            return {
              message: "Ya existe un inversionista con ese nombre",
              error: "duplicate_nombre",
            };
          }
        }
      }

      if (!existente && !isStrictCreate) {
        if (inv.dpi) {
          // Compatibilidad legacy: upsert por DPI.
          const result = await db
            .select()
            .from(inversionistas)
            .where(eq(inversionistas.dpi, inv.dpi))
            .limit(1);
          existente = result[0] || null;
        }

        if (!existente && inv.email?.trim()) {
          // Compatibilidad legacy: upsert por email.
          const email = inv.email.trim().toLowerCase();
          const result = await db
            .select()
            .from(inversionistas)
            .where(ilike(inversionistas.email, email))
            .limit(1);
          existente = result[0] || null;
        }

        if (!existente && inv.nombre?.trim()) {
          // Compatibilidad legacy: upsert por nombre.
          const result = await db
            .select()
            .from(inversionistas)
            .where(eq(inversionistas.nombre, inv.nombre.trim()))
            .limit(1);
          existente = result[0] || null;
        }
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
      if (detalle.includes("email")) {
        set.status = 409;
        return {
          message: "Ya existe un inversionista con ese email",
          error: "duplicate_email",
        };
      }
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
        total_reinv_tipo_capital: new Big(0),
        total_reinv_tipo_interes: new Big(0),
        total_reinv_tipo_total: new Big(0),
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
          let total_reinv_tipo_capital = new Big(0);
          let total_reinv_tipo_interes = new Big(0);
          let total_reinv_tipo_total = new Big(0);

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

              if (reinversionActual === "reinversion_capital") total_reinv_tipo_capital = total_reinv_tipo_capital.plus(totalReinvNeta);
              else if (reinversionActual === "reinversion_interes") total_reinv_tipo_interes = total_reinv_tipo_interes.plus(totalReinvNeta);
              else if (reinversionActual === "reinversion_total") total_reinv_tipo_total = total_reinv_tipo_total.plus(totalReinvNeta);

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
                cuota: Number(cuota) || 0,
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
          subtotal.total_reinv_tipo_capital = subtotal.total_reinv_tipo_capital.plus(total_reinv_tipo_capital);
          subtotal.total_reinv_tipo_interes = subtotal.total_reinv_tipo_interes.plus(total_reinv_tipo_interes);
          subtotal.total_reinv_tipo_total = subtotal.total_reinv_tipo_total.plus(total_reinv_tipo_total);

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
          total_reinv_tipo_capital: formatValue(subtotal.total_reinv_tipo_capital.toString()),
          total_reinv_tipo_interes: formatValue(subtotal.total_reinv_tipo_interes.toString()),
          total_reinv_tipo_total: formatValue(subtotal.total_reinv_tipo_total.toString()),
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
      // 🔑 Reinversión Neta (reinvInteres ya viene neto: con IVA sumado o ISR restado)
      subtotal.total_reinversion = subtotal.total_reinversion.plus(reinvCapital.plus(reinvInteres));
      subtotal.total_reinversion_capital = subtotal.total_reinversion_capital.plus(reinvCapital);
      subtotal.total_reinversion_interes = subtotal.total_reinversion_interes.plus(reinvInteres);
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

/**
 * Detecta pagos huérfanos: pagos en pagos_credito_inversionistas_espejo cuyo
 * credito_id ya no existe en creditos_inversionistas_espejo para ese inversionista
 * (el crédito fue removido de la participación pero el pago quedó).
 */
export async function detectPagosHuerfanos(
  inversionistaId: number,
  liquidacionId: number
) {
  const huerfanos = await db
    .select({
      pago_id: pagos_credito_inversionistas_espejo.id,
      credito_id: pagos_credito_inversionistas_espejo.credito_id,
      fecha_pago: pagos_credito_inversionistas_espejo.fecha_pago,
    })
    .from(pagos_credito_inversionistas_espejo)
    .leftJoin(
      creditos_inversionistas_espejo,
      and(
        eq(
          creditos_inversionistas_espejo.credito_id,
          pagos_credito_inversionistas_espejo.credito_id
        ),
        eq(
          creditos_inversionistas_espejo.inversionista_id,
          pagos_credito_inversionistas_espejo.inversionista_id
        )
      )
    )
    .where(
      and(
        eq(pagos_credito_inversionistas_espejo.inversionista_id, inversionistaId),
        eq(pagos_credito_inversionistas_espejo.liquidacion_id, liquidacionId),
        isNull(creditos_inversionistas_espejo.id)
      )
    );

  return huerfanos;
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

        // ========================================
        // FASE 5: SALIDA AUTOMÁTICA (pendiente_devolucion)
        // Si el inversionista quedó marcado como `pendiente_devolucion`,
        // se ejecuta exitInvestor sobre los créditos con pagos liquidados
        // en esta corrida. exitInvestor traslada la participación a CUBE
        // y marca al inversionista como `inactivo`. Como salvaguarda,
        // forzamos el status a `inactivo` después.
        // ========================================
        try {
          const [invRow] = await db
            .select({ status: inversionistas.status })
            .from(inversionistas)
            .where(eq(inversionistas.inversionista_id, inv_id))
            .limit(1);

          if (invRow?.status === "pendiente_devolucion") {
            const creditoIdsSalida = [
              ...new Set(pagosNoLiquidados.map((p) => p.credito_id)),
            ];

            if (creditoIdsSalida.length > 0) {
              console.log(
                `  🚪 Inversionista ${inv_id} en pendiente_devolucion → exitInvestor sobre ${creditoIdsSalida.length} crédito(s)`
              );

              const exitResult = await exitInvestor({
                body: {
                  inversionista_id: inv_id,
                  creditos: creditoIdsSalida,
                },
                set: { status: 200 },
                request: {} as any,
              });

              console.log(`  ✅ Salida ejecutada:`, exitResult);

              await db
                .update(inversionistas)
                .set({ status: "inactivo" })
                .where(eq(inversionistas.inversionista_id, inv_id));

              console.log(`  ✅ Inversionista ${inv_id} marcado como inactivo`);
            } else {
              console.warn(
                `  ⚠️ Inversionista ${inv_id} pendiente_devolucion pero sin créditos con pagos en esta corrida; se omite exitInvestor`
              );
            }
          }
        } catch (exitError) {
          console.error(
            `  ❌ Error en salida automática (liquidación ya guardada):`,
            exitError
          );
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
      const grupos = ['reinversion_capital', 'reinversion_interes', 'reinversion_total', 'sin_reinversion'];

      return grupos.map(grupo => {
        const credGrupo = creditosData.filter(c => {
          const t = c.tipo_reinversion || 'sin_reinversion';
          return t === grupo;
        });
        if (credGrupo.length === 0) return '';

        const tableHead = `
          <thead><tr>
            <th>Meses en crédito</th><th>Nombre</th><th>Capital</th>
            <th>% Interés</th><th>% Inversionista</th><th>Tasa interés inversor</th>
            <th>Interés Inversor</th><th>IVA</th><th>ISR</th>
            <th>Abono capital</th><th>% Inv. Interés Neto</th><th>Capital restante</th>
            <th>Cuota de mes</th><th>Plazo</th><th>NIT</th>
          </tr></thead>`;

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
            <th>% Inversionista Interés Neto</th>
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

export const updateInvestorStatus = async ({ body, set, request }: any) => {
  try {
    const { inversionista_id, status } = body ?? {};

    if (typeof inversionista_id !== "number" || !Number.isFinite(inversionista_id)) {
      set.status = 400;
      return { success: false, message: "inversionista_id es obligatorio y debe ser numérico" };
    }
    const STATUS_VALIDOS = ["activo", "inactivo", "pendiente_devolucion"] as const;
    if (!STATUS_VALIDOS.includes(status)) {
      set.status = 400;
      return {
        success: false,
        message: `status debe ser uno de: ${STATUS_VALIDOS.join(", ")}`,
      };
    }

    const [current] = await db
      .select({
        inversionista_id: inversionistas.inversionista_id,
        nombre: inversionistas.nombre,
        email: inversionistas.email,
        status: inversionistas.status,
        tipo_reinversion: inversionistas.tipo_reinversion,
      })
      .from(inversionistas)
      .where(eq(inversionistas.inversionista_id, inversionista_id));

    if (!current) {
      set.status = 404;
      return { success: false, message: `Inversionista ${inversionista_id} no encontrado` };
    }

    if (current.status === status) {
      set.status = 200;
      return {
        success: true,
        message: `El inversionista ya se encuentra ${status}. No se realizaron cambios.`,
        inversionista: current,
        correos_enviados: 0,
      };
    }

    // Cuando el inversionista pasa a "pendiente_devolucion", forzamos que
    // deje de reinvertir. Así la próxima liquidación no genera más capital
    // reinvertido y el saldo queda listo para devolverse.
    const setReinversionASinReinversion =
      status === "pendiente_devolucion" && current.tipo_reinversion !== "sin_reinversion";

    const updateData: {
      status: typeof status;
      tipo_reinversion?: "sin_reinversion";
    } = { status };
    if (setReinversionASinReinversion) {
      updateData.tipo_reinversion = "sin_reinversion";
    }

    const [updated] = await db
      .update(inversionistas)
      .set(updateData)
      .where(eq(inversionistas.inversionista_id, inversionista_id))
      .returning();

    let usuarioEmail: string | undefined;
    let usuarioNombre: string | undefined;
    try {
      const authHeader = request?.headers?.get?.("Authorization");
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.replace("Bearer ", "").trim();
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        usuarioEmail = decoded.email ?? decoded.correo ?? undefined;
        usuarioNombre = decoded.nombre ?? decoded.name ?? undefined;
      }
    } catch (err) {
      console.warn("[updateInvestorStatus] No se pudo resolver el usuario del JWT:", err);
    }

    const accionMap: Record<typeof status, { label: string; color: string }> = {
      activo: { label: "ACTIVADO", color: "#16a34a" },
      inactivo: { label: "INACTIVADO", color: "#dc2626" },
      pendiente_devolucion: { label: "PENDIENTE DE DEVOLUCIÓN", color: "#d97706" },
    };
    const { label: accion, color: colorEstado } = accionMap[status];
    const fechaGT = new Date().toLocaleString("es-GT", { timeZone: "America/Guatemala" });

    const accionPendienteHtml =
      status === "pendiente_devolucion"
        ? `
        <div style="margin-top:16px; padding:12px 14px; border-left:4px solid #d97706; background:#fef3c7; border-radius:4px;">
          <p style="margin:0; font-weight:bold; color:#92400e;">⚠️ Acción pendiente</p>
          <p style="margin:6px 0 0 0; color:#92400e;">
            En la próxima liquidación se le devolverá el saldo correspondiente a este inversionista.
            Por favor verificar antes de correr el proceso de liquidación para incluir el monto a devolver.
          </p>
        </div>
      `
        : "";

    const subject = `Inversionista ${accion}: ${current.nombre}`;
    const html = `
      <div style="font-family: Arial, sans-serif; color:#111;">
        <h2 style="margin-bottom: 8px;">Cambio de estado de inversionista</h2>
        <p>
          El inversionista
          <strong>${current.nombre}</strong>
          (ID: ${current.inversionista_id})
          pasó a
          <strong style="color:${colorEstado};">${accion}</strong>.
        </p>
        <table style="border-collapse: collapse; margin-top: 8px;">
          <tr><td style="padding:4px 8px;"><strong>Estado anterior:</strong></td><td style="padding:4px 8px;">${current.status}</td></tr>
          <tr><td style="padding:4px 8px;"><strong>Estado nuevo:</strong></td><td style="padding:4px 8px; color:${colorEstado};"><strong>${status}</strong></td></tr>
          <tr><td style="padding:4px 8px;"><strong>Fecha (GT):</strong></td><td style="padding:4px 8px;">${fechaGT}</td></tr>
          ${usuarioNombre || usuarioEmail
            ? `<tr><td style="padding:4px 8px;"><strong>Ejecutado por:</strong></td><td style="padding:4px 8px;">${[usuarioNombre, usuarioEmail].filter(Boolean).join(" — ")}</td></tr>`
            : ""}
        </table>
        ${accionPendienteHtml}
        <p style="margin-top:16px; color:#555; font-size:12px;">Correo automático — Club Cash In / Cartera.</p>
      </div>
    `;

    // Cuando el inversionista pasa a 'activo' NO se envía correo: solo
    // se notifica en salidas (inactivo / pendiente_devolucion).
    if (status === "activo") {
      set.status = 200;
      return {
        success: true,
        message: `Inversionista marcado como ${status} correctamente (sin correo)`,
        inversionista: updated,
        correos_enviados: 0,
        correos_fallidos: 0,
        total_destinatarios: 0,
      };
    }

    const mailResults = await Promise.allSettled(
      INVESTOR_STATUS_CHANGE_RECIPIENTS.map((to) => sendPlainEmail(to, subject, html))
    );

    const enviados = mailResults.filter(
      (r) => r.status === "fulfilled" && (r as any).value?.success
    ).length;
    const fallidos = INVESTOR_STATUS_CHANGE_RECIPIENTS.length - enviados;

    if (fallidos > 0) {
      console.warn(
        `[updateInvestorStatus] ${fallidos} correo(s) fallaron de ${INVESTOR_STATUS_CHANGE_RECIPIENTS.length}`,
        mailResults
      );
    }

    set.status = 200;
    return {
      success: true,
      message: `Inversionista marcado como ${status} correctamente`,
      inversionista: updated,
      correos_enviados: enviados,
      correos_fallidos: fallidos,
      total_destinatarios: INVESTOR_STATUS_CHANGE_RECIPIENTS.length,
    };
  } catch (error) {
    console.error("[updateInvestorStatus] Error:", error);
    set.status = 500;
    return {
      success: false,
      message: "Error al actualizar el status del inversionista",
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

// ============================================================================
// ID fijo de CUBE INVESTMENTS S.A.
// CUBE es "la casa": el inversionista principal al que se le
// devuelve/absorbe la participación cuando otros inversionistas entran o salen.
// ============================================================================
const CUBE_INVESTMENT_ID = 86;

// ============================================================================
// CONTROLLER: exitInvestor
// ============================================================================
//
// PROPÓSITO
// Saca a un inversionista del sistema transfiriéndole toda su participación
// a CUBE en los créditos indicados, y lo marca como `inactivo`. Al final
// notifica por correo a la lista hardcodeada de destinatarios.
//
// FLUJO GENERAL (todo dentro de una transacción)
// Para cada `credito_id` de la lista:
//   1. Leer el row del inversionista en `creditos_inversionistas` (PADRE).
//      Si no está → se salta y se reporta en `errores` (no aborta todo).
//   2. Ver si CUBE ya tiene row en ese crédito:
//      - Caso A (SWAP): CUBE NO está → UPDATE set inversionista_id=CUBE
//        en el row del inversionista. Mismo monto, misma cuota, mismos
//        campos. CUBE "toma la posición" tal cual.
//      - Caso B (MERGE): CUBE YA está → sumar al row de CUBE los campos
//        numéricos del inversionista (monto_aportado, porcentaje, cuota,
//        intereses, IVA) y DELETE el row del inversionista.
//   3. Mismo tratamiento en `creditos_inversionistas_espejo`, dejando
//      `status = "completado"` (se cierra cualquier pendiente).
//   4. `creditos.bandera_reinversion = false` (ya no hay pendientes en
//      este crédito asociados al inversionista).
// Al terminar el loop, si se procesó al menos un crédito:
//   5. `inversionistas.status = "inactivo"`.
// Fuera de la transacción:
//   6. Mandar correo a los destinatarios fijos con el detalle: créditos
//      afectados, monto devuelto a CUBE por cada uno, total, ejecutor.
//
// NOTAS DE DISEÑO
// - No se recalcula la distribución del resto del pool (a diferencia de
//   `addInvestorToCredit` / `manualReassignInvestor`). La premisa del
//   negocio es: "el row pasa a ser de CUBE tal cual"; por simetría, en
//   el merge simplemente se suman los absolutos al row de CUBE existente.
// - `porcentaje_cash_in` de CUBE se preserva en el caso B (no se suma).
//   Es el único campo "configuración" que se mantiene; el resto son
//   montos/porcentajes/cuotas que son agregables.
// - Los `.returning()` sirven para loggear cuántos rows tocó cada
//   operación; si un UPDATE/DELETE no afecta rows, el log lo evidencia.
// - `runId` identifica los logs de una misma ejecución para poder
//   hilarlos cuando hay varios requests concurrentes.
//
// VALIDACIONES
// - `inversionista_id` debe ser numérico.
// - `creditos` debe ser un array no vacío de números.
// - No se permite sacar a CUBE del sistema (`inversionista_id !== 86`).
// - El inversionista debe existir en `inversionistas`.
//
// RESPUESTAS
// - 200: operación exitosa (puede traer algunos `errores` parciales).
// - 400: validación falló O ningún crédito se pudo procesar (entonces
//   el inversionista NO queda inactivo).
// - 404: inversionista no encontrado.
// - 500: error inesperado (la transacción hace rollback).
// ============================================================================
export const exitInvestor = async ({ body, set, request }: any) => {
  // ── Helper de logging con prefijo único por request ──
  // runId: 6 chars alfanuméricos en mayúsculas, para hilar logs de un
  // mismo request cuando hay múltiples corriendo en paralelo.
  const runId = Math.random().toString(36).slice(2, 8).toUpperCase();
  const log = (...args: any[]) => console.log(`[exitInvestor][${runId}]`, ...args);
  const warn = (...args: any[]) => console.warn(`[exitInvestor][${runId}]`, ...args);
  const err = (...args: any[]) => console.error(`[exitInvestor][${runId}]`, ...args);
  const t0 = Date.now(); // Para medir duración total al final

  try {
    log("═══════════════════════════════════════════════════════════");
    log("🚀 Inicio de salida de inversionista");
    log("📥 Body recibido:", JSON.stringify(body));

    // ========================================================================
    // PASO 1: VALIDACIÓN DEL BODY
    // ========================================================================
    // Se valida manualmente (Elysia ya valida el schema a nivel router, pero
    // acá defendemos por si se llama internamente sin pasar por el router).
    const { inversionista_id, creditos: creditoIds } = body ?? {};

    if (typeof inversionista_id !== "number" || !Number.isFinite(inversionista_id)) {
      warn("❌ Validación falló: inversionista_id inválido →", inversionista_id);
      set.status = 400;
      return { success: false, message: "inversionista_id es obligatorio y debe ser numérico" };
    }
    if (!Array.isArray(creditoIds) || creditoIds.length === 0 || !creditoIds.every((id) => typeof id === "number" && Number.isFinite(id))) {
      warn("❌ Validación falló: creditos inválido →", creditoIds);
      set.status = 400;
      return { success: false, message: "creditos debe ser un arreglo no vacío de números" };
    }
    // Salvaguarda: CUBE es la contraparte, nunca puede ser el "saliente".
    if (inversionista_id === CUBE_INVESTMENT_ID) {
      warn("❌ Intento de sacar a CUBE. Bloqueado.");
      set.status = 400;
      return { success: false, message: "No se puede sacar a CUBE del sistema" };
    }

    log(`✅ Validación OK — inversionista_id=${inversionista_id}, creditos=${creditoIds.length} [${creditoIds.join(", ")}]`);

    // ========================================================================
    // PASO 2: VERIFICAR QUE EL INVERSIONISTA EXISTA
    // ========================================================================
    // Traemos nombre y status actual para:
    //   - devolverlos en la respuesta,
    //   - loggear el cambio,
    //   - incluirlos en el correo (estado anterior → nuevo).
    const [invRow] = await db
      .select({
        inversionista_id: inversionistas.inversionista_id,
        nombre: inversionistas.nombre,
        status: inversionistas.status,
      })
      .from(inversionistas)
      .where(eq(inversionistas.inversionista_id, inversionista_id));

    if (!invRow) {
      warn(`❌ Inversionista ${inversionista_id} no encontrado en DB`);
      set.status = 404;
      return { success: false, message: `Inversionista ${inversionista_id} no encontrado` };
    }

    log(`👤 Inversionista encontrado: [${invRow.inversionista_id}] ${invRow.nombre} (status=${invRow.status})`);

    // ========================================================================
    // PASO 3: ACUMULADORES DE RESULTADOS
    // ========================================================================
    // - `resultados`: créditos que se procesaron OK (para respuesta + correo).
    // - `errores`: créditos que se saltaron (no existen / inversionista no
    //   está en ellos). No abortan la transacción: se reportan pero se sigue.
    // - `totalTransferido`: suma de montos movidos a CUBE (usando Big.js
    //   para evitar problemas de precisión de floats).
    const resultados: Array<{
      credito_id: number;
      numero_credito_sifco: string | null;
      monto_transferido: string;
      cube_preexistente: boolean;
      accion: "swap" | "merge";
    }> = [];
    const errores: Array<{ credito_id: number; razon: string }> = [];
    let totalTransferido = new Big(0);

    // ========================================================================
    // PASO 4: TRANSACCIÓN PRINCIPAL
    // ========================================================================
    // Todo el trabajo (padre + espejo + bandera + status final) va en una
    // sola transacción. Si algo falla, ROLLBACK total: ni cambia el status
    // del inversionista, ni queda nada a medias en los créditos.
    log("🔒 Abriendo transacción...");
    await db.transaction(async (tx) => {
      for (const [idx, credito_id] of creditoIds.entries()) {
        log(`─────────────────────────────────────────────────────────`);
        log(`📂 [${idx + 1}/${creditoIds.length}] Procesando crédito_id=${credito_id}`);

        // ────────────────────────────────────────────────────────────────────
        // 4.1 — Verificar que el crédito exista.
        // Solo se trae SIFCO porque lo necesitamos para el log y el correo.
        // ────────────────────────────────────────────────────────────────────
        const [creditoData] = await tx
          .select({
            credito_id: creditos.credito_id,
            numero_credito_sifco: creditos.numero_credito_sifco,
          })
          .from(creditos)
          .where(eq(creditos.credito_id, credito_id))
          .limit(1);

        if (!creditoData) {
          warn(`   ⚠️  Crédito ${credito_id} no existe → agregado a errores`);
          errores.push({ credito_id, razon: "Crédito no existe" });
          continue; // Se sigue con el próximo crédito de la lista
        }
        log(`   ✅ Crédito existe — SIFCO=${creditoData.numero_credito_sifco ?? "(null)"}`);

        // ────────────────────────────────────────────────────────────────────
        // 4.2 — Leer row del inversionista en PADRE (creditos_inversionistas).
        // Este row es el que vamos a "swappear" o "mergear" con CUBE.
        // Si el inversionista no está aquí, no hay nada que mover en este
        // crédito → se reporta como error y se salta.
        // ────────────────────────────────────────────────────────────────────
        const [invEnPadre] = await tx
          .select()
          .from(creditos_inversionistas)
          .where(
            and(
              eq(creditos_inversionistas.credito_id, credito_id),
              eq(creditos_inversionistas.inversionista_id, inversionista_id),
            ),
          )
          .limit(1);

        if (!invEnPadre) {
          warn(`   ⚠️  Inversionista ${inversionista_id} NO está en creditos_inversionistas de este crédito → agregado a errores`);
          errores.push({ credito_id, razon: `Inversionista ${inversionista_id} no está en este crédito` });
          continue;
        }
        log(`   💰 Row padre del inversionista: monto_aportado=${invEnPadre.monto_aportado}, cuota=${invEnPadre.cuota_inversionista}, %participacion=${invEnPadre.porcentaje_participacion_inversionista}`);

        // ────────────────────────────────────────────────────────────────────
        // 4.3 — Ver si CUBE ya tiene row en este crédito.
        // La presencia/ausencia de CUBE define el camino:
        //   - Sin CUBE → SWAP (cambiar el inversionista_id del row).
        //   - Con CUBE → MERGE (sumar campos + borrar row del inversionista).
        // ────────────────────────────────────────────────────────────────────
        const [cubeEnPadre] = await tx
          .select()
          .from(creditos_inversionistas)
          .where(
            and(
              eq(creditos_inversionistas.credito_id, credito_id),
              eq(creditos_inversionistas.inversionista_id, CUBE_INVESTMENT_ID),
            ),
          )
          .limit(1);

        // Monto que va a quedar "a nombre de" CUBE en este crédito.
        // Usamos Big.js para no perder precisión al sumar montos monetarios.
        const montoTransferido = new Big(invEnPadre.monto_aportado);
        const cubePreexistente = !!cubeEnPadre;

        // Monto final que va a tener CUBE en PADRE tras la operación.
        // - SWAP: lo que aportaba el inversionista (el row es el mismo).
        // - MERGE: suma del que ya tenía CUBE + el del inversionista.
        // Este mismo valor se fuerza en el espejo para que espejo = padre
        // (Opción 1: sincronización total de capital).
        const nuevoMontoCubePadre: Big = cubeEnPadre
          ? new Big(cubeEnPadre.monto_aportado).plus(new Big(invEnPadre.monto_aportado))
          : new Big(invEnPadre.monto_aportado);

        if (cubePreexistente && cubeEnPadre) {
          log(`   🟡 CUBE YA existe en el crédito (padre): monto_aportado=${cubeEnPadre.monto_aportado}`);
        } else {
          log(`   🟢 CUBE NO existe en el crédito (padre)`);
        }

        if (!cubeEnPadre) {
          // ──────────────────────────────────────────────────────────────────
          // 4.4A — CASO A: SWAP en PADRE
          // CUBE no está en el crédito → cambiamos el `inversionista_id` del
          // row del inversionista a CUBE. El row conserva monto, cuota, etc.,
          // pero forzamos los porcentajes de CUBE (100/100): CUBE siempre
          // tiene participación total y cash-in total en el row que ocupa.
          // ──────────────────────────────────────────────────────────────────
          log(`   🔄 [PADRE] Caso A (SWAP): cambiando inversionista_id ${inversionista_id} → ${CUBE_INVESTMENT_ID} (porcentajes forzados a 100/100)`);
          const resA = await tx
            .update(creditos_inversionistas)
            .set({
              inversionista_id: CUBE_INVESTMENT_ID,
              porcentaje_cash_in: "100",
              porcentaje_participacion_inversionista: "100",
            })
            .where(
              and(
                eq(creditos_inversionistas.credito_id, credito_id),
                eq(creditos_inversionistas.inversionista_id, inversionista_id),
              ),
            )
            .returning({ id: creditos_inversionistas.id });
          log(`   ✅ [PADRE] SWAP aplicado en ${resA.length} row(s)`);
        } else {
          // ──────────────────────────────────────────────────────────────────
          // 4.4B — CASO B: MERGE en PADRE
          // CUBE ya está en el crédito → no podemos tener dos rows de CUBE
          // (uniqueIndex ux_credito_inversionista). Entonces:
          //   1. Sumar los campos de monto/cuota/intereses/IVA del
          //      inversionista al row de CUBE.
          //   2. Forzar porcentaje_cash_in=100 y
          //      porcentaje_participacion_inversionista=100 (no se suman —
          //      CUBE siempre queda al 100/100 en su row).
          //   3. Borrar el row del inversionista.
          // No se tocan otros inversionistas del pool.
          // ──────────────────────────────────────────────────────────────────
          const suma = (a: string | number, b: string | number) => new Big(a).plus(new Big(b)).toString();
          const payload = {
            monto_aportado: suma(cubeEnPadre.monto_aportado, invEnPadre.monto_aportado),
            porcentaje_participacion_inversionista: "100",
            porcentaje_cash_in: "100",
            monto_inversionista: suma(cubeEnPadre.monto_inversionista, invEnPadre.monto_inversionista),
            monto_cash_in: suma(cubeEnPadre.monto_cash_in, invEnPadre.monto_cash_in),
            iva_inversionista: suma(cubeEnPadre.iva_inversionista, invEnPadre.iva_inversionista),
            iva_cash_in: suma(cubeEnPadre.iva_cash_in, invEnPadre.iva_cash_in),
            cuota_inversionista: suma(cubeEnPadre.cuota_inversionista, invEnPadre.cuota_inversionista),
          };
          log(`   🔀 [PADRE] Caso B (MERGE): sumando en CUBE + porcentajes 100/100 →`, payload);

          const resB1 = await tx
            .update(creditos_inversionistas)
            .set(payload)
            .where(
              and(
                eq(creditos_inversionistas.credito_id, credito_id),
                eq(creditos_inversionistas.inversionista_id, CUBE_INVESTMENT_ID),
              ),
            )
            .returning({ id: creditos_inversionistas.id });
          log(`   ✅ [PADRE] MERGE aplicado en row CUBE (${resB1.length})`);

          const resB2 = await tx
            .delete(creditos_inversionistas)
            .where(
              and(
                eq(creditos_inversionistas.credito_id, credito_id),
                eq(creditos_inversionistas.inversionista_id, inversionista_id),
              ),
            )
            .returning({ id: creditos_inversionistas.id });
          log(`   ✅ [PADRE] DELETE row del inversionista (${resB2.length})`);
        }

        // ────────────────────────────────────────────────────────────────────
        // 4.5 — Mismo tratamiento en la tabla ESPEJO (creditos_inversionistas_espejo)
        // El espejo refleja el estado "operativo" que usa el proceso de
        // liquidación. La lógica es idéntica al padre (SWAP vs MERGE), pero
        // además forzamos `status = "completado"` en el row resultante para
        // cerrar cualquier pendiente que tuviera el inversionista.
        //
        // Si el inversionista no tiene row en espejo para este crédito
        // (escenario posible por desincronizaciones históricas), se salta
        // esta sección sin error.
        // ────────────────────────────────────────────────────────────────────
        const [invEnEspejo] = await tx
          .select()
          .from(creditos_inversionistas_espejo)
          .where(
            and(
              eq(creditos_inversionistas_espejo.credito_id, credito_id),
              eq(creditos_inversionistas_espejo.inversionista_id, inversionista_id),
            ),
          )
          .limit(1);

        if (!invEnEspejo) {
          log(`   ℹ️  [ESPEJO] Inversionista NO tiene row en espejo de este crédito — se salta el espejo`);
        } else {
          log(`   💰 [ESPEJO] Row del inversionista: monto_aportado=${invEnEspejo.monto_aportado}, status=${invEnEspejo.status}`);

          // Mismo check de "¿existe CUBE en espejo?" para definir SWAP vs MERGE
          const [cubeEnEspejo] = await tx
            .select()
            .from(creditos_inversionistas_espejo)
            .where(
              and(
                eq(creditos_inversionistas_espejo.credito_id, credito_id),
                eq(creditos_inversionistas_espejo.inversionista_id, CUBE_INVESTMENT_ID),
              ),
            )
            .limit(1);

          if (!cubeEnEspejo) {
            // 4.5A — ESPEJO SWAP: cambia id, fuerza status=completado,
            // fija porcentajes de CUBE a 100/100 y sincroniza monto_aportado
            // con el valor del PADRE (para que CUBE quede con el capital
            // "original", sin descuentos por pagos previos).
            log(`   🔄 [ESPEJO] Caso A (SWAP): cambiando inversionista_id ${inversionista_id} → ${CUBE_INVESTMENT_ID}, status→completado, porcentajes 100/100, monto_aportado=${nuevoMontoCubePadre.toString()} (sincronizado con padre)`);
            const resEA = await tx
              .update(creditos_inversionistas_espejo)
              .set({
                inversionista_id: CUBE_INVESTMENT_ID,
                porcentaje_cash_in: "100",
                porcentaje_participacion_inversionista: "0",
                monto_aportado: nuevoMontoCubePadre.toString(),
                status: "completado",
                updated_at: new Date(),
              })
              .where(
                and(
                  eq(creditos_inversionistas_espejo.credito_id, credito_id),
                  eq(creditos_inversionistas_espejo.inversionista_id, inversionista_id),
                ),
              )
              .returning({ id: creditos_inversionistas_espejo.id });
            log(`   ✅ [ESPEJO] SWAP aplicado (${resEA.length})`);
          } else {
            // 4.5B — ESPEJO MERGE: sumar intereses/IVA del investor al row
            // CUBE, forzar porcentajes a 100/100 y fijar monto_aportado al
            // valor del PADRE (sincroniza capital, ignora cuánto había en
            // espejo para ese campo).
            log(`   🟡 [ESPEJO] CUBE YA existe en espejo: monto_aportado=${cubeEnEspejo.monto_aportado}, status=${cubeEnEspejo.status}`);
            const suma = (a: string | number, b: string | number) =>
              new Big(a).plus(new Big(b)).toString();

            const payloadE = {
              monto_aportado: nuevoMontoCubePadre.toString(),
              porcentaje_participacion_inversionista: "0",
              porcentaje_cash_in: "100",
              monto_inversionista: suma(cubeEnEspejo.monto_inversionista, invEnEspejo.monto_inversionista),
              monto_cash_in: suma(cubeEnEspejo.monto_cash_in, invEnEspejo.monto_cash_in),
              iva_inversionista: suma(cubeEnEspejo.iva_inversionista, invEnEspejo.iva_inversionista),
              iva_cash_in: suma(cubeEnEspejo.iva_cash_in, invEnEspejo.iva_cash_in),
              cuota_inversionista: suma(cubeEnEspejo.cuota_inversionista, invEnEspejo.cuota_inversionista),
              status: "completado" as const,
              updated_at: new Date(),
            };
            log(`   🔀 [ESPEJO] Caso B (MERGE): porcentajes 100, monto_aportado=${nuevoMontoCubePadre.toString()} (sincronizado con padre) →`, payloadE);

            const resEB1 = await tx
              .update(creditos_inversionistas_espejo)
              .set(payloadE)
              .where(
                and(
                  eq(creditos_inversionistas_espejo.credito_id, credito_id),
                  eq(creditos_inversionistas_espejo.inversionista_id, CUBE_INVESTMENT_ID),
                ),
              )
              .returning({ id: creditos_inversionistas_espejo.id });
            log(`   ✅ [ESPEJO] MERGE aplicado en row CUBE (${resEB1.length})`);

            const resEB2 = await tx
              .delete(creditos_inversionistas_espejo)
              .where(
                and(
                  eq(creditos_inversionistas_espejo.credito_id, credito_id),
                  eq(creditos_inversionistas_espejo.inversionista_id, inversionista_id),
                ),
              )
              .returning({ id: creditos_inversionistas_espejo.id });
            log(`   ✅ [ESPEJO] DELETE row del inversionista (${resEB2.length})`);
          }
        }

        // ────────────────────────────────────────────────────────────────────
        // 4.6 — Apagar bandera_reinversion del crédito.
        // Esta bandera, cuando está en true, redirige los intereses del
        // inversionista "pendiente" hacia CUBE. Como ya no hay ningún
        // inversionista en ese estado (lo acabamos de sacar o fusionar con
        // CUBE), la bandera pierde sentido y se apaga.
        // ────────────────────────────────────────────────────────────────────
        const resBandera = await tx
          .update(creditos)
          .set({ bandera_reinversion: false })
          .where(eq(creditos.credito_id, credito_id))
          .returning({ credito_id: creditos.credito_id });
        log(`   🏁 bandera_reinversion=false aplicada en crédito ${credito_id} (${resBandera.length})`);

        // ────────────────────────────────────────────────────────────────────
        // 4.7 — Acumular resultado del crédito.
        // Monto transferido se agrega al total global y se deja un resumen
        // en `resultados[]` para incluirlo en la respuesta y el correo.
        // ────────────────────────────────────────────────────────────────────
        totalTransferido = totalTransferido.plus(montoTransferido);
        resultados.push({
          credito_id,
          numero_credito_sifco: creditoData.numero_credito_sifco ?? null,
          monto_transferido: montoTransferido.toFixed(2),
          cube_preexistente: cubePreexistente,
          accion: cubePreexistente ? "merge" : "swap",
        });
        log(`   ✅ Crédito ${credito_id} procesado — monto_transferido=Q${montoTransferido.toFixed(2)}, acción=${cubePreexistente ? "merge" : "swap"}`);
        log(`   📊 Total acumulado transferido a CUBE: Q${totalTransferido.toFixed(2)}`);
      }

      log(`─────────────────────────────────────────────────────────`);
      log(`📊 Resumen transacción: procesados=${resultados.length}, errores=${errores.length}, total=Q${totalTransferido.toFixed(2)}`);

      // ──────────────────────────────────────────────────────────────────────
      // 4.8 — Cambio final de status del inversionista.
      // Solo se aplica si al menos un crédito se procesó. Si todos fallaron
      // (p.ej. todos los credit_ids no tenían al inversionista), NO se cambia
      // el status — sería prematuro marcarlo como inactivo sin haberlo
      // sacado efectivamente de ningún crédito.
      // ──────────────────────────────────────────────────────────────────────
      if (resultados.length > 0) {
        log(`🔻 Pasando inversionista ${inversionista_id} → status='inactivo'`);
        const resStatus = await tx
          .update(inversionistas)
          .set({ status: "inactivo" })
          .where(eq(inversionistas.inversionista_id, inversionista_id))
          .returning({ inversionista_id: inversionistas.inversionista_id, status: inversionistas.status });
        log(`   ✅ Status actualizado:`, resStatus[0]);
      } else {
        warn(`⚠️  Ningún crédito se procesó → NO se cambia el status del inversionista`);
      }
    });
    log(`🔓 Transacción COMMIT`);

    // ========================================================================
    // PASO 5: SALIDA TEMPRANA SI NO SE HIZO NADA
    // ========================================================================
    // Si la transacción terminó sin haber procesado un solo crédito,
    // respondemos 400 y NO mandamos correo (no hay nada que notificar).
    if (resultados.length === 0) {
      warn(`🚫 Sin créditos procesados — respondiendo 400 y sin correo`);
      set.status = 400;
      return {
        success: false,
        message: "No se procesó ningún crédito. El inversionista no fue inactivado.",
        errores,
      };
    }

    // ========================================================================
    // PASO 6: RESOLVER USUARIO EJECUTOR (OPCIONAL)
    // ========================================================================
    // A partir del JWT del request tratamos de sacar nombre y correo del
    // usuario que disparó la operación. Va en try/catch: si el token está
    // expirado o mal formado, seguimos sin ejecutor (el correo lo muestra
    // como "no identificado").
    let usuarioEmail: string | undefined;
    let usuarioNombre: string | undefined;
    try {
      const authHeader = request?.headers?.get?.("Authorization");
      if (authHeader?.startsWith("Bearer ")) {
        const token = authHeader.replace("Bearer ", "").trim();
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        usuarioEmail = decoded.email ?? decoded.correo ?? undefined;
        usuarioNombre = decoded.nombre ?? decoded.name ?? undefined;
        log(`🔐 JWT resuelto → usuarioNombre=${usuarioNombre ?? "(none)"} usuarioEmail=${usuarioEmail ?? "(none)"}`);
      } else {
        log(`🔐 Sin header Authorization (o no es Bearer) — correo sin ejecutor`);
      }
    } catch (jwtErr) {
      warn("🔐 No se pudo resolver el usuario del JWT:", jwtErr);
    }

    // ========================================================================
    // PASO 7: ARMAR Y ENVIAR EL CORREO
    // ========================================================================
    // Fecha en GT (zona horaria Guatemala) para mostrar el momento exacto
    // del cambio sin depender de la zona del server.
    const fechaGT = new Date().toLocaleString("es-GT", { timeZone: "America/Guatemala" });
    const subject = `Inversionista INACTIVADO (cartera transferida a CUBE): ${invRow.nombre}`;

    // Una fila por crédito procesado, con SIFCO, ID interno, monto y
    // leyenda de qué acción se tomó (swap vs merge).
    const filasCreditos = resultados
      .map(
        (r) => `
          <tr>
            <td style="padding:6px 10px; border:1px solid #e5e7eb;">${r.numero_credito_sifco ?? "—"}</td>
            <td style="padding:6px 10px; border:1px solid #e5e7eb;">${r.credito_id}</td>
            <td style="padding:6px 10px; border:1px solid #e5e7eb; text-align:right;">Q${r.monto_transferido}</td>
            <td style="padding:6px 10px; border:1px solid #e5e7eb;">${r.accion === "merge" ? "Sumado a CUBE existente" : "CUBE tomó la posición"}</td>
          </tr>
        `,
      )
      .join("");

    // Si hubo créditos saltados, se listan al final en rojo para que
    // el equipo pueda revisarlos aparte.
    const erroresHtml =
      errores.length > 0
        ? `
          <h3 style="margin-top:16px; color:#b91c1c;">Créditos omitidos</h3>
          <ul style="color:#b91c1c;">
            ${errores.map((e) => `<li>Crédito ${e.credito_id}: ${e.razon}</li>`).join("")}
          </ul>
        `
        : "";

    const html = `
      <div style="font-family: Arial, sans-serif; color:#111;">
        <h2 style="margin-bottom: 8px;">Salida de inversionista — cartera transferida a CUBE</h2>
        <p>
          El inversionista <strong>${invRow.nombre}</strong> (ID: ${invRow.inversionista_id})
          fue <strong style="color:#dc2626;">INACTIVADO</strong>.
          Su participación en los créditos listados fue transferida a <strong>CUBE INVESTMENTS S.A.</strong>
        </p>
        <table style="border-collapse: collapse; margin-top: 8px;">
          <tr><td style="padding:4px 8px;"><strong>Estado anterior:</strong></td><td style="padding:4px 8px;">${invRow.status}</td></tr>
          <tr><td style="padding:4px 8px;"><strong>Estado nuevo:</strong></td><td style="padding:4px 8px; color:#dc2626;"><strong>inactivo</strong></td></tr>
          <tr><td style="padding:4px 8px;"><strong>Fecha (GT):</strong></td><td style="padding:4px 8px;">${fechaGT}</td></tr>
          ${usuarioNombre || usuarioEmail
            ? `<tr><td style="padding:4px 8px;"><strong>Ejecutado por:</strong></td><td style="padding:4px 8px;">${[usuarioNombre, usuarioEmail].filter(Boolean).join(" — ")}</td></tr>`
            : ""}
          <tr><td style="padding:4px 8px;"><strong>Total transferido a CUBE:</strong></td><td style="padding:4px 8px;"><strong>Q${totalTransferido.toFixed(2)}</strong></td></tr>
          <tr><td style="padding:4px 8px;"><strong>Créditos procesados:</strong></td><td style="padding:4px 8px;">${resultados.length}</td></tr>
        </table>

        <h3 style="margin-top:16px;">Créditos transferidos</h3>
        <table style="border-collapse: collapse; margin-top: 4px; min-width: 520px;">
          <thead>
            <tr style="background:#f3f4f6;">
              <th style="padding:6px 10px; border:1px solid #e5e7eb; text-align:left;">SIFCO</th>
              <th style="padding:6px 10px; border:1px solid #e5e7eb; text-align:left;">Crédito ID</th>
              <th style="padding:6px 10px; border:1px solid #e5e7eb; text-align:right;">Monto a CUBE</th>
              <th style="padding:6px 10px; border:1px solid #e5e7eb; text-align:left;">Acción</th>
            </tr>
          </thead>
          <tbody>${filasCreditos}</tbody>
        </table>
        ${erroresHtml}
        <p style="margin-top:16px; color:#555; font-size:12px;">Correo automático — Club Cash In / Cartera.</p>
      </div>
    `;

    log(`📧 Enviando correo a ${INVESTOR_STATUS_CHANGE_RECIPIENTS.length} destinatario(s): [${INVESTOR_STATUS_CHANGE_RECIPIENTS.join(", ")}]`);
    log(`📧 Asunto: "${subject}"`);

    // `allSettled` para que un destinatario que falle no tumbe el resto.
    // Enviamos individualmente (sendPlainEmail acepta un solo `to`) en paralelo.
    const mailResults = await Promise.allSettled(
      INVESTOR_STATUS_CHANGE_RECIPIENTS.map((to) => sendPlainEmail(to, subject, html)),
    );

    mailResults.forEach((r, i) => {
      const to = INVESTOR_STATUS_CHANGE_RECIPIENTS[i];
      if (r.status === "fulfilled" && (r as any).value?.success) {
        log(`   ✉️  OK → ${to} (id=${(r as any).value?.data?.id ?? "?"})`);
      } else if (r.status === "fulfilled") {
        warn(`   ✉️  FAIL → ${to}:`, (r as any).value?.error);
      } else {
        warn(`   ✉️  REJECTED → ${to}:`, r.reason);
      }
    });

    const enviados = mailResults.filter(
      (r) => r.status === "fulfilled" && (r as any).value?.success,
    ).length;
    const fallidos = INVESTOR_STATUS_CHANGE_RECIPIENTS.length - enviados;
    log(`📧 Correos: enviados=${enviados}, fallidos=${fallidos}`);

    log(`⏱️  Duración total: ${Date.now() - t0}ms`);
    log(`✅ DONE — inversionista ${invRow.inversionista_id} inactivado, ${resultados.length} crédito(s), Q${totalTransferido.toFixed(2)} a CUBE`);
    log("═══════════════════════════════════════════════════════════");

    // ========================================================================
    // PASO 8: RESPUESTA FINAL
    // ========================================================================
    // Se devuelve todo el detalle para que el frontend pueda mostrar un
    // resumen (inversionista, total, créditos uno por uno, errores y
    // métricas de correo).
    set.status = 200;
    return {
      success: true,
      message: `Inversionista inactivado. ${resultados.length} crédito(s) transferido(s) a CUBE. Total: Q${totalTransferido.toFixed(2)}.`,
      inversionista: { inversionista_id: invRow.inversionista_id, nombre: invRow.nombre, status: "inactivo" },
      total_transferido_a_cube: totalTransferido.toFixed(2),
      creditos_procesados: resultados,
      errores,
      correos_enviados: enviados,
      correos_fallidos: fallidos,
      total_destinatarios: INVESTOR_STATUS_CHANGE_RECIPIENTS.length,
    };
  } catch (error) {
    err("💥 Error fatal:", error);
    err(`⏱️  Duración hasta el error: ${Date.now() - t0}ms`);
    err("═══════════════════════════════════════════════════════════");
    set.status = 500;
    return {
      success: false,
      message: "Error al procesar la salida del inversionista",
      error: error instanceof Error ? error.message : String(error),
    };
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
  status: "activo" | "inactivo" | "pendiente_devolucion";
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
  total_reinversion_capital: number;
  total_reinversion_interes: number;
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
  status: "activo" | "inactivo" | "pendiente_devolucion";
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
  total_reinversion_capital: number;
  total_reinversion_interes: number;
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
    status: inversionistas.status,
    banco_nombre: bancos.nombre,
    tipo_cuenta: inversionistas.tipo_cuenta,
    numero_cuenta: inversionistas.numero_cuenta,
    total_abono_capital: sql<number>`COALESCE(SUM(${pe.abono_capital}), 0)`,
    total_abono_interes: sql<number>`COALESCE(SUM(${pe.abono_interes}), 0)`,
    total_abono_iva: sql<number>`COALESCE(SUM(${pe.abono_iva_12}), 0)`,
    total_reinversion_capital: sql<number>`0`,
    total_reinversion_interes: sql<number>`0`,
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
    inversionistas.status,
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
    status: inversionistas.status,
    banco_nombre: bancos.nombre,
    tipo_cuenta: inversionistas.tipo_cuenta,
    numero_cuenta: inversionistas.numero_cuenta,
    total_abono_capital: sql<number>`COALESCE(SUM(${liquidaciones.total_capital}), 0)`,
    total_abono_interes: sql<number>`COALESCE(SUM(${liquidaciones.total_interes}), 0)`,
    total_abono_iva: sql<number>`COALESCE(SUM(${liquidaciones.total_iva}), 0)`,
    total_isr: sql<number>`COALESCE(SUM(${liquidaciones.total_isr}), 0)`,
    total_abono_general_interes: sql<number>`COALESCE(SUM(${liquidaciones.total_interes} + ${liquidaciones.total_iva} - ${liquidaciones.total_isr}), 0)`,
    total_reinversion: sql<number>`COALESCE(SUM(${liquidaciones.reinversion_total}), 0)`,
    total_reinversion_capital: sql<number>`COALESCE(SUM(${liquidaciones.reinversion_capital}), 0)`,
    total_reinversion_interes: sql<number>`COALESCE(SUM(${liquidaciones.reinversion_interes}), 0)`,
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
    inversionistas.status,
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
    status: inv.status,
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
    total_reinversion_capital: convert(inv.total_reinversion_capital),
    total_reinversion_interes: convert(inv.total_reinversion_interes),
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
  workbook.creator = "Club Cashin";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Resumen Inversionistas", {
    views: [{ showGridLines: false }],
  });

  // Paleta corporativa
  const COLOR = {
    navy: "FF0F1B4C",
    blue: "FF1E40AF",
    blueLight: "FFDBE6F8",
    green: "FF00B050",
    greenSoft: "FFD7F0DA",
    grayHeader: "FF305496",
    zebra: "FFF7F8FA",
    border: "FFB7BCC8",
    textMuted: "FF64748B",
    isrMuted: "FFE0E0E0",
  };

  const headers = [
    "ID",
    "Nombre",
    ...(includeEstado ? ["Estado"] : []),
    "Status Inversionista",
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
    "Reinversión Capital",
    "Reinversión Interés",
    "Reinversión",
    "Total con Reinversión",
    "Cuota",
  ];

  const lastColLetter = (() => {
    const n = headers.length;
    let s = "";
    let v = n;
    while (v > 0) {
      const r = (v - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      v = Math.floor((v - 1) / 26);
    }
    return s;
  })();

  // ── Encabezado con logo + título ────────────────────────────────────────────
  const logoUrl = process.env.LOGO_URL || "";
  let logoCols = 0;
  if (logoUrl) {
    try {
      const res = await fetch(logoUrl);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const ct = res.headers.get("content-type") || "";
        const ext: "png" | "jpeg" = ct.includes("png") ? "png" : "jpeg";
        const imgId = workbook.addImage({
          base64: buf.toString("base64"),
          extension: ext,
        });
        sheet.addImage(imgId, {
          tl: { col: 0, row: 0 },
          ext: { width: 140, height: 70 },
        });
        logoCols = 2;
      }
    } catch {
      // si falla la imagen seguimos sin logo
    }
  }

  // Filas 1-3 reservadas para el header del reporte
  sheet.getRow(1).height = 28;
  sheet.getRow(2).height = 24;
  sheet.getRow(3).height = 20;

  const titleStartCol = logoCols > 0 ? logoCols + 1 : 1;
  const titleStartLetter = String.fromCharCode(64 + titleStartCol);

  sheet.mergeCells(`${titleStartLetter}1:${lastColLetter}2`);
  const titleCell = sheet.getCell(`${titleStartLetter}1`);
  titleCell.value = "Resumen de Inversionistas";
  titleCell.font = { bold: true, size: 18, color: { argb: COLOR.navy } };
  titleCell.alignment = { horizontal: "left", vertical: "middle" };

  sheet.mergeCells(`${titleStartLetter}3:${lastColLetter}3`);
  const fechaCell = sheet.getCell(`${titleStartLetter}3`);
  const ahora = new Date();
  fechaCell.value = `Generado el ${ahora.toLocaleString("es-GT", {
    timeZone: "America/Guatemala",
  })}`;
  fechaCell.font = { italic: true, size: 10, color: { argb: COLOR.textMuted } };
  fechaCell.alignment = { horizontal: "left", vertical: "middle" };

  // Fila 4 vacía como separador
  sheet.getRow(4).height = 6;

  // ── Header de columnas en fila 5 ────────────────────────────────────────────
  const HEADER_ROW = 5;
  const headerRow = sheet.getRow(HEADER_ROW);
  headers.forEach((h, i) => {
    headerRow.getCell(i + 1).value = h;
  });
  headerRow.height = 32;
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: COLOR.blue },
  };
  headerRow.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  headerRow.eachCell((cell) => {
    cell.border = {
      top: { style: "thin", color: { argb: COLOR.border } },
      bottom: { style: "medium", color: { argb: COLOR.navy } },
      left: { style: "thin", color: { argb: COLOR.border } },
      right: { style: "thin", color: { argb: COLOR.border } },
    };
  });

  // Header de "Cuota" resaltado en verde
  const cuotaHeaderCell = headerRow.getCell(headers.length);
  cuotaHeaderCell.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: COLOR.green },
  };
  cuotaHeaderCell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };

  // Mapa de etiquetas para el estado de liquidación en el Excel
  const estadoLabel: Record<string, string> = {
    pending: "Pendiente",
    uploaded: "Boleta subida",
    liquidated: "Liquidado",
    sin_movimiento: "Pendiente de liquidar",
  };

  // Acumuladores para fila de TOTALES
  const totales = {
    capital: 0,
    interes: 0,
    iva: 0,
    isr: 0,
    sin_reinversion: 0,
    reinversion_capital: 0,
    reinversion_interes: 0,
    reinversion: 0,
    con_reinversion: 0,
    cuota: 0,
  };

  // Índices de columnas (1-based, según orden en `headers`)
  const offset = includeEstado ? 1 : 0; // columna "Estado" desplaza todo en 1
  const isrCellIndex = 12 + offset;
  const firstMoneyColumn = 9 + offset;
  const lastMoneyColumn = 18 + offset;

  rows.forEach((inv, idx) => {
    const estadoRaw =
      "estado_liquidacion_resumen" in inv ? inv.estado_liquidacion_resumen : "";
    const estadoCell = estadoRaw ? estadoLabel[estadoRaw] ?? estadoRaw : "";

    const row = sheet.addRow([
      inv.inversionista_id,
      inv.nombre,
      ...(includeEstado ? [estadoCell] : []),
      inv.status ?? "",
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
      Number(inv.total_reinversion_capital ?? 0).toFixed(2),
      Number(inv.total_reinversion_interes ?? 0).toFixed(2),
      Number(inv.total_reinversion).toFixed(2),
      Number(inv.total_a_recibir_con_reinversion).toFixed(2),
      Number(inv.total_cuota).toFixed(2),
    ]);

    row.height = 18;
    row.alignment = { vertical: "middle" };

    totales.capital += Number(inv.total_abono_capital) || 0;
    totales.interes += Number(inv.total_abono_interes) || 0;
    totales.iva += Number(inv.total_abono_iva) || 0;
    totales.isr += Number(inv.total_isr) || 0;
    totales.sin_reinversion += Number(inv.total_a_recibir_sin_reinversion) || 0;
    totales.reinversion_capital += Number(inv.total_reinversion_capital ?? 0) || 0;
    totales.reinversion_interes += Number(inv.total_reinversion_interes ?? 0) || 0;
    totales.reinversion += Number(inv.total_reinversion) || 0;
    totales.con_reinversion += Number(inv.total_a_recibir_con_reinversion) || 0;
    totales.cuota += Number(inv.total_cuota) || 0;

    // Zebra striping y bordes
    const isZebra = idx % 2 === 1;
    row.eachCell({ includeEmpty: true }, (cell) => {
      if (isZebra) {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: COLOR.zebra },
        };
      }
      cell.border = {
        top: { style: "hair", color: { argb: COLOR.border } },
        bottom: { style: "hair", color: { argb: COLOR.border } },
        left: { style: "hair", color: { argb: COLOR.border } },
        right: { style: "hair", color: { argb: COLOR.border } },
      };
    });

    // Negrita para nombre y tipo de reinversión (más fácil de leer)
    row.getCell(2).font = { bold: true, color: { argb: COLOR.navy } };
    row.getCell(5 + offset).font = { italic: true, color: { argb: COLOR.textMuted } }; // Reinversión (tipo)

    if (inv.emite_factura) {
      const isrCell = row.getCell(isrCellIndex);
      isrCell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: COLOR.isrMuted },
      };
      isrCell.font = { color: { argb: "FF808080" } };
    }

    for (let i = firstMoneyColumn; i <= lastMoneyColumn; i++) {
      row.getCell(i).numFmt = "Q#,##0.00";
    }

    // Resaltar columna "Cuota" (última columna) en verde suave
    const cuotaCell = row.getCell(lastMoneyColumn);
    cuotaCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLOR.greenSoft },
    };
    cuotaCell.font = { bold: true, color: { argb: COLOR.navy } };
  });

  // ── Fila de TOTALES al final ────────────────────────────────────────────────
  if (rows.length > 0) {
    const totalesRowData: any[] = new Array(headers.length).fill("");
    totalesRowData[0] = "";
    totalesRowData[1] = "TOTALES";
    totalesRowData[firstMoneyColumn - 1] = Number(totales.capital).toFixed(2);
    totalesRowData[firstMoneyColumn] = Number(totales.interes).toFixed(2);
    totalesRowData[firstMoneyColumn + 1] = Number(totales.iva).toFixed(2);
    totalesRowData[firstMoneyColumn + 2] = Number(totales.isr).toFixed(2);
    totalesRowData[firstMoneyColumn + 3] = Number(totales.sin_reinversion).toFixed(2);
    totalesRowData[firstMoneyColumn + 4] = Number(totales.reinversion_capital).toFixed(2);
    totalesRowData[firstMoneyColumn + 5] = Number(totales.reinversion_interes).toFixed(2);
    totalesRowData[firstMoneyColumn + 6] = Number(totales.reinversion).toFixed(2);
    totalesRowData[firstMoneyColumn + 7] = Number(totales.con_reinversion).toFixed(2);
    totalesRowData[firstMoneyColumn + 8] = Number(totales.cuota).toFixed(2);

    const totalesRow = sheet.addRow(totalesRowData);
    totalesRow.height = 24;
    totalesRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    totalesRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLOR.grayHeader },
    };
    totalesRow.alignment = { vertical: "middle" };
    totalesRow.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = {
        top: { style: "medium", color: { argb: COLOR.navy } },
        bottom: { style: "medium", color: { argb: COLOR.navy } },
        left: { style: "thin", color: { argb: COLOR.border } },
        right: { style: "thin", color: { argb: COLOR.border } },
      };
    });
    for (let i = firstMoneyColumn; i <= lastMoneyColumn; i++) {
      totalesRow.getCell(i).numFmt = "Q#,##0.00";
    }
    const totalesCuotaCell = totalesRow.getCell(lastMoneyColumn);
    totalesCuotaCell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: COLOR.green },
    };
  }

  // ── Anchos de columna inteligentes ──────────────────────────────────────────
  sheet.columns.forEach((col, i) => {
    let maxLength = 10;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const v = cell.value;
      if (v == null) return;
      const txt = typeof v === "object" ? "" : String(v);
      const len = txt.length;
      if (len > maxLength) maxLength = len;
    });
    // El ID puede ser angosto; el nombre necesita más espacio
    if (i === 0) col.width = 6;
    else if (i === 1) col.width = Math.min(Math.max(maxLength + 2, 22), 36);
    else col.width = Math.min(maxLength + 3, 28);
  });

  // Filtros + congelar header
  sheet.autoFilter = {
    from: { row: HEADER_ROW, column: 1 },
    to: { row: HEADER_ROW, column: headers.length },
  };
  sheet.views = [
    { state: "frozen", xSplit: 2, ySplit: HEADER_ROW, showGridLines: false },
  ];

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
  excel: boolean = false,
  incluirSinMovimiento: boolean = false
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

  if (incluirSinMovimiento) {
    const idsConMovimiento = new Set(result.map((r) => r.inversionista_id));
    const filtros: any[] = [eq(inversionistas.permite_distribucion, false)];
    if (inversionistaId) {
      filtros.push(eq(inversionistas.inversionista_id, inversionistaId));
    }

    const todos = await db
      .select({
        inversionista_id: inversionistas.inversionista_id,
        nombre: inversionistas.nombre,
        moneda: inversionistas.moneda,
        emite_factura: inversionistas.emite_factura,
        reinversion: inversionistas.tipo_reinversion,
        status: inversionistas.status,
        banco_nombre: bancos.nombre,
        tipo_cuenta: inversionistas.tipo_cuenta,
        numero_cuenta: inversionistas.numero_cuenta,
      })
      .from(inversionistas)
      .leftJoin(bancos, eq(inversionistas.banco_id, bancos.banco_id))
      .where(and(...filtros));

    for (const inv of todos) {
      if (idsConMovimiento.has(inv.inversionista_id)) continue;

      const stub: InversionistaResumenRow = {
        inversionista_id: inv.inversionista_id,
        nombre: inv.nombre,
        moneda: inv.moneda as "quetzales" | "dolares",
        emite_factura: inv.emite_factura,
        reinversion: inv.reinversion as InversionistaResumenRow["reinversion"],
        status: inv.status as InversionistaResumenRow["status"],
        banco_nombre: inv.banco_nombre,
        tipo_cuenta: inv.tipo_cuenta,
        numero_cuenta: inv.numero_cuenta,
        total_abono_capital: 0,
        total_abono_interes: 0,
        total_abono_iva: 0,
        total_isr: 0,
        total_abono_general_interes: 0,
        total_a_recibir_sin_reinversion: 0,
        total_reinversion: 0,
        total_reinversion_capital: 0,
        total_reinversion_interes: 0,
        total_a_recibir_con_reinversion: 0,
        total_cuota: 0,
        reporte_liquidacion_url: null,
      };

      result.push({
        ...mapResumenRow(stub, null, null),
        estado_liquidacion_resumen: "sin_movimiento",
      });
    }
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

const ID_BANCO_TRANSFERENCIA_NO_ACH = "45";

const NOMBRES_MES_ES = [
  "Enero",
  "Febrero",
  "Marzo",
  "Abril",
  "Mayo",
  "Junio",
  "Julio",
  "Agosto",
  "Septiembre",
  "Octubre",
  "Noviembre",
  "Diciembre",
];

const CUENTA_MONETARIA_LARGO = 11;

function parseCuentaMonetaria(numeroCuenta: string | null | undefined): {
  agencia: string;
  correlativo: string;
  digito: string;
  valido: boolean;
} {
  const limpia = (numeroCuenta ?? "").replace(/\D/g, "");
  const valido = limpia.length === CUENTA_MONETARIA_LARGO;
  return {
    agencia: limpia.slice(0, 3),
    correlativo: limpia.slice(3, -1),
    digito: limpia.slice(-1),
    valido,
  };
}

function mapTipoCuentaCodigo(tipo: string | null | undefined): {
  codigo: number | "";
  valido: boolean;
} {
  if (!tipo) return { codigo: "", valido: false };
  const upper = tipo.toUpperCase();
  if (upper.includes("MONETARIA")) return { codigo: 1, valido: true };
  if (upper.includes("AHORRO")) return { codigo: 2, valido: true };
  return { codigo: "", valido: false };
}

function mapMonedaCodigo(moneda: string | null | undefined): 1 | 2 {
  return moneda === "dolares" ? 2 : 1;
}

export type MonedaFiltroTransferencias = "quetzales" | "dolar" | "todas";

export async function resumenTransferencias(
  mes: number,
  anio: number,
  ach: boolean,
  monedaFiltro: MonedaFiltroTransferencias = "todas"
): Promise<{ success: boolean; url: string; filename: string }> {
  const condicionesBanco = ach
    ? and(
        eq(inversionistas.permite_distribucion, false),
        or(
          isNull(bancos.id_banco_transferencia),
          ne(bancos.id_banco_transferencia, ID_BANCO_TRANSFERENCIA_NO_ACH)
        )
      )
    : and(
        eq(inversionistas.permite_distribucion, false),
        eq(bancos.id_banco_transferencia, ID_BANCO_TRANSFERENCIA_NO_ACH)
      );

  const inversionistasFiltro = await db
    .select({
      inversionista_id: inversionistas.inversionista_id,
      id_banco_transferencia: bancos.id_banco_transferencia,
    })
    .from(inversionistas)
    .leftJoin(bancos, eq(inversionistas.banco_id, bancos.banco_id))
    .where(condicionesBanco);

  const bancoTransfMap = new Map(
    inversionistasFiltro.map((i) => [i.inversionista_id, i.id_banco_transferencia ?? ""])
  );

  if (bancoTransfMap.size === 0) {
    return ach
      ? generateAchTransferenciasWorkbook([], mes, anio, bancoTransfMap)
      : generateTransferenciasWorkbook([], mes, anio);
  }

  const resumen = await consultarResumenGlobalPorEstadoPago(
    "NO_LIQUIDADO",
    undefined,
    mes,
    anio,
    true
  );

  let monedaPermitida: "quetzales" | "dolares" | null = null;
  if (monedaFiltro === "quetzales") monedaPermitida = "quetzales";
  else if (monedaFiltro === "dolar") monedaPermitida = "dolares";

  const filtrados = resumen.filter((r) => {
    if (!bancoTransfMap.has(r.inversionista_id)) return false;
    if (monedaPermitida && r.moneda !== monedaPermitida) return false;
    return true;
  });
  const filas = filtrados.map((inv) => mapResumenRow(inv, null, null));

  return ach
    ? generateAchTransferenciasWorkbook(filas, mes, anio, bancoTransfMap)
    : generateTransferenciasWorkbook(filas, mes, anio);
}

async function generateAchTransferenciasWorkbook(
  rows: InversionistaResumen[],
  mes: number,
  anio: number,
  bancoTransfMap: Map<number, string>
): Promise<{ success: boolean; url: string; filename: string }> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Club Cashin";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Transferencias ACH");

  const RED_FILL = "FFFFC7CE";
  const HEADER_FILL = "FF1E40AF";
  const HEADER_BORDER = "FF0F1B4C";
  const nombreMes = NOMBRES_MES_ES[mes - 1] ?? `Mes ${mes}`;

  const headers = [
    "Nombre",
    "Id Participante",
    "Cuenta credito / debito",
    "Tipo Cuenta",
    "Moneda",
    "Banco",
    "Descripcion Corta",
    "Adenda",
    "Valor Q.",
  ];
  sheet.columns = [
    { width: 28 }, // Nombre
    { width: 18 }, // Id Participante
    { width: 24 }, // Cuenta crédito / débito
    { width: 14 }, // Tipo Cuenta
    { width: 12 }, // Moneda
    { width: 10 }, // Banco
    { width: 24 }, // Descripción Corta
    { width: 60 }, // Adenda
    { width: 16 }, // Valor Q.
  ];

  const headerRow = sheet.addRow(headers);
  headerRow.height = 24;
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  headerRow.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HEADER_FILL },
    };
    cell.border = {
      top: { style: "thin", color: { argb: HEADER_BORDER } },
      bottom: { style: "medium", color: { argb: HEADER_BORDER } },
      left: { style: "thin", color: { argb: HEADER_BORDER } },
      right: { style: "thin", color: { argb: HEADER_BORDER } },
    };
  });

  rows.forEach((inv) => {
    const valor = Number(inv.total_cuota) || 0;
    if (valor === 0) return;

    const concepto = `Liquidación ${nombreMes} ${anio}, Club CashIn S.A`;
    const adenda = concepto.slice(0, 80);
    const tipoCuenta = mapTipoCuentaCodigo(inv.tipo_cuenta);
    const moneda = mapMonedaCodigo(inv.moneda);
    const banco = bancoTransfMap.get(inv.inversionista_id) ?? "";
    const cuentaLimpia = (inv.numero_cuenta ?? "").replace(/\D/g, "");

    const row = sheet.addRow([
      inv.nombre,
      "",
      cuentaLimpia,
      tipoCuenta.codigo,
      moneda,
      banco,
      concepto,
      adenda,
      valor,
    ]);
    row.getCell(9).numFmt = "0.00";

    const filaInvalida = !tipoCuenta.valido || !banco;
    if (filaInvalida) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: RED_FILL },
        };
      });
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `transferencias_ach_${anio}_${String(mes).padStart(2, "0")}_${Date.now()}.xlsx`;
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

async function generateTransferenciasWorkbook(
  rows: InversionistaResumen[],
  mes: number,
  anio: number
): Promise<{ success: boolean; url: string; filename: string }> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Club Cashin";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("Transferencias");

  const RED_FILL = "FFFFC7CE";
  const HEADER_FILL = "FF1E40AF";
  const HEADER_BORDER = "FF0F1B4C";
  const nombreMes = NOMBRES_MES_ES[mes - 1] ?? `Mes ${mes}`;

  const headers = ["Agencia", "Correlativo", "Dígito", "Moneda", "Concepto", "Valor"];
  sheet.columns = [
    { width: 12 }, // Agencia
    { width: 16 }, // Correlativo
    { width: 10 }, // Dígito
    { width: 12 }, // Moneda
    { width: 60 }, // Concepto
    { width: 16 }, // Valor
  ];
  const headerRow = sheet.addRow(headers);
  headerRow.height = 24;
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
  headerRow.alignment = { horizontal: "center", vertical: "middle" };
  headerRow.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: HEADER_FILL },
    };
    cell.border = {
      top: { style: "thin", color: { argb: HEADER_BORDER } },
      bottom: { style: "medium", color: { argb: HEADER_BORDER } },
      left: { style: "thin", color: { argb: HEADER_BORDER } },
      right: { style: "thin", color: { argb: HEADER_BORDER } },
    };
  });

  rows.forEach((inv) => {
    const valor = Number(inv.total_cuota) || 0;
    if (valor === 0) return;

    const { agencia, correlativo, digito, valido } = parseCuentaMonetaria(inv.numero_cuenta);
    const concepto = `Liquidación ${nombreMes} ${anio} - ${inv.nombre}, Club CashIn S.A`;
    const moneda = mapMonedaCodigo(inv.moneda);

    const row = sheet.addRow([agencia, correlativo, digito, moneda, concepto, valor]);
    row.getCell(6).numFmt = "0.00";

    if (!valido) {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: RED_FILL },
        };
      });
    }
  });

  const buffer = await workbook.xlsx.writeBuffer();
  const filename = `transferencias_${anio}_${String(mes).padStart(2, "0")}_${Date.now()}.xlsx`;
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

  // 2️⃣ Obtener totales de inversiones de forma agregada (solo créditos completados)
  const [totalesInversion] = await db
    .select({
      capital_total: sql<string>`coalesce(sum(${creditos_inversionistas_espejo.monto_aportado}), 0)`,
      cantidad: count(),
    })
    .from(creditos_inversionistas_espejo)
    .where(
      and(
        eq(creditos_inversionistas_espejo.inversionista_id, inversionista.inversionista_id),
        eq(creditos_inversionistas_espejo.status, "completado"),
      ),
    );

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
export async function getCreditosEspejoPendientes(
  page: number = 1,
  pageSize: number = 10,
  search?: string,
  inversionistaId?: number,
) {
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
      and(
        sql`${creditos_inversionistas_espejo.status} IN ('pendiente_reinversion', 'pendiente_compra_cartera', 'pendiente_revision')`,
        inversionistaId !== undefined
          ? eq(creditos_inversionistas_espejo.inversionista_id, inversionistaId)
          : undefined,
      ),
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
