import { db } from "../database/index";
import { SQL_CARTERA_SCHEMA } from "../database/db/schema";
import { withCapitalContext, setCapitalSource } from "../utils/withAuditContext";
import {
  aseguradoras,
  asesores,
  bad_debts,
  boletas,
  convenio_cuotas,
  convenios_pago,
  convenios_pagos_resume,
  credit_cancelations,
  creditos,
  creditos_inversionistas,
  creditos_inversionistas_espejo,
  creditos_rubros_otros,
  cuotas_credito,
  inversionistas,
  montos_adicionales,
  moras_credito,
  pagos_credito,
  platform_users,
  StatusCredit,
  usuarios,
} from "../database/db/schema";
import { z } from "zod";
import Big from "big.js";
import {
  and,
  desc,
  eq,
  sql,
  inArray,
  asc,
  lte,
  lt,
  gte,
  gt,
  isNull,
} from "drizzle-orm";
import { getPagosDelMesActual, insertPagosCreditoInversionistasV2 } from "./payments";
import { distribuirAbonoCapitalEspejo } from "./abonosCapital";
import { buildNameSearchCondition } from "../utils/functions/generalFunctions";
import { bucketDeCredito, BucketCatalogo, getBucketsCatalogo, STATUS_BUCKET_FUERA } from "./latefee";

// Fallback B0-B5 — usado si el catálogo dinámico `cartera.buckets` no
// responde (DB caída, migración pendiente). Incluye `estados_incluidos` en B5
// (mismo valor que el seed de 0001_buckets_catalogo.sql) para no perder la
// regla INCOBRABLE→B5 de `bucketDeCredito` en este path degradado. `prefijo`/
// `nombre`/`estado_mora` sintéticos (mismo seed de 0003) para que la columna
// Bucket y el contrato de /stats (estadoMora/label/prefijo) no queden vacíos
// en un ambiente degradado.
const FALLBACK_BUCKETS_CUOTAS: {
  numero: number;
  cuotas_min: number;
  cuotas_max: number | null;
  estados_incluidos: string[];
  prefijo: string;
  nombre: string;
  estado_mora: string;
}[] = [
  { numero: 0, cuotas_min: 0, cuotas_max: 0, estados_incluidos: [], prefijo: "B0", nombre: "Cartera Sana", estado_mora: "al_dia" },
  { numero: 1, cuotas_min: 1, cuotas_max: 1, estados_incluidos: [], prefijo: "B1", nombre: "Alerta Temprana", estado_mora: "mora_30" },
  { numero: 2, cuotas_min: 2, cuotas_max: 2, estados_incluidos: [], prefijo: "B2", nombre: "Gestión Activa", estado_mora: "mora_60" },
  { numero: 3, cuotas_min: 3, cuotas_max: 3, estados_incluidos: [], prefijo: "B3", nombre: "Rescate", estado_mora: "mora_90" },
  { numero: 4, cuotas_min: 4, cuotas_max: 4, estados_incluidos: [], prefijo: "B4", nombre: "Última Instancia / Pre Jurídico", estado_mora: "mora_120" },
  { numero: 5, cuotas_min: 5, cuotas_max: null, estados_incluidos: ["INCOBRABLE"], prefijo: "B5", nombre: "Jurídico", estado_mora: "mora_120_plus" },
];


export const getCreditoByNumero = async (numero_credito_sifco: string) => {
  try {
    // 1. Buscar el crédito con su usuario
    const creditoData = await db
      .select()
      .from(creditos)
      .where(
        and(
          eq(creditos.numero_credito_sifco, numero_credito_sifco),
          inArray(creditos.statusCredit, [
            "ACTIVO",
            "PENDIENTE_CANCELACION",
            "MOROSO",
            "EN_CONVENIO",
            "INCOBRABLE"
          ])
        )
      )
      .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .innerJoin(asesores, eq(creditos.asesor_id, asesores.asesor_id))
      .limit(1);

    if (creditoData.length === 0) {
      return { message: "Crédito no encontrado" };
    }

    const currentCredit = creditoData[0];
    const creditoId = currentCredit.creditos.credito_id;

    // 2. Si el crédito está cancelado o pendiente de cancelación, verificar si hay cancelación activa
    if (
      currentCredit.creditos.statusCredit === "CANCELADO" ||
      currentCredit.creditos.statusCredit === "PENDIENTE_CANCELACION"
    ) {
      // Buscar la info de cancelación (solo si está activa)
      const cancelacion = await db
        .select()
        .from(credit_cancelations)
        .where(
          and(
            eq(credit_cancelations.credit_id, creditoId),
            eq(credit_cancelations.activo, true)
          )
        )
        .limit(1);

      // Solo retornar flujo CANCELADO si hay una cancelación activa
      if (cancelacion.length > 0) {
        return {
          credito: currentCredit.creditos,
          usuario: currentCredit.usuarios,
          asesor: currentCredit.asesores,
          cancelacion: cancelacion[0],
          flujo: "CANCELADO",
        };
      }
      // Si no hay cancelación activa, continuar con el flujo normal
    }

    // 2. Consultar todas las cuotas pagadas (pagado = true)
    const cuotasPagadas = await db
      .select({
        // Campos de cuotas_credito
        cuota_id: cuotas_credito.cuota_id,
        credito_id: cuotas_credito.credito_id,
        numero_cuota: cuotas_credito.numero_cuota,
        fecha_vencimiento: cuotas_credito.fecha_vencimiento,
        pagado: cuotas_credito.pagado,
        createdAt: cuotas_credito.createdAt,

        // 🔥 Campos de pagos_credito - ABONOS
        pago_id: pagos_credito.pago_id,
        monto_boleta: pagos_credito.monto_boleta,
        abono_capital: pagos_credito.abono_capital,
        abono_interes: pagos_credito.abono_interes,
        abono_iva_12: pagos_credito.abono_iva_12,
        abono_interes_ci: pagos_credito.abono_interes_ci,
        abono_iva_ci: pagos_credito.abono_iva_ci,
        abono_seguro: pagos_credito.abono_seguro,
        abono_gps: pagos_credito.abono_gps,
        abono_membresias: pagos_credito.membresias_mes,

        // 🔥 RESTANTES
        capital_restante: pagos_credito.capital_restante,
        interes_restante: pagos_credito.interes_restante,
        iva_12_restante: pagos_credito.iva_12_restante,
        seguro_restante: pagos_credito.seguro_restante,
        gps_restante: pagos_credito.gps_restante,
        membresias_restante: pagos_credito.membresias,
        pago_mora: pagos_credito.mora,
        pago_otros: pagos_credito.otros,

        // 🔥 FLAG
        pago_cuota_completa: pagos_credito.pagado,

        validationStatus: pagos_credito.validationStatus,
      })
      .from(cuotas_credito)
      .leftJoin(
        pagos_credito,
        eq(pagos_credito.cuota_id, cuotas_credito.cuota_id)
      )
      .where(
        and(
          eq(cuotas_credito.credito_id, creditoId),
          eq(cuotas_credito.pagado, true)
        )
      )
      .orderBy(cuotas_credito.numero_cuota);

    // 4. Calcular la cuota que toca este mes (según meses transcurridos desde fecha_creacion)
    const fechaInicio = new Date(currentCredit.creditos.fecha_creacion);
    const hoy = new Date();
    const mesesTranscurridos =
      (hoy.getFullYear() - fechaInicio.getFullYear()) * 12 +
      (hoy.getMonth() - fechaInicio.getMonth()) +
      1;

    // 5. Consultar cuotas pendientes (no pagadas y ya deberían haberse pagado)
    const cuotasAtrasadas = await db
      .select({
        cuota_id: cuotas_credito.cuota_id,
        credito_id: cuotas_credito.credito_id,
        numero_cuota: cuotas_credito.numero_cuota,
        fecha_vencimiento: cuotas_credito.fecha_vencimiento,
        pagado: cuotas_credito.pagado,
        createdAt: cuotas_credito.createdAt,
        validationStatus: pagos_credito.validationStatus,
        pago_id: pagos_credito.pago_id,

        monto_boleta: pagos_credito.monto_boleta,
        abono_capital: pagos_credito.abono_capital,
        abono_interes: pagos_credito.abono_interes,
        abono_iva_12: pagos_credito.abono_iva_12,
        abono_interes_ci: pagos_credito.abono_interes_ci,
        abono_iva_ci: pagos_credito.abono_iva_ci,
        abono_seguro: pagos_credito.abono_seguro,
        abono_gps: pagos_credito.abono_gps,
        abono_membresias: pagos_credito.membresias_mes,

        // 🔥 RESTANTES
        capital_restante: pagos_credito.capital_restante,
        interes_restante: pagos_credito.interes_restante,
        iva_12_restante: pagos_credito.iva_12_restante,
        seguro_restante: pagos_credito.seguro_restante,
        gps_restante: pagos_credito.gps_restante,
        membresias_restante: pagos_credito.membresias,
        pago_mora: pagos_credito.mora,
        pago_otros: pagos_credito.otros,
      })
      .from(cuotas_credito)
      .leftJoin(
        pagos_credito,
        eq(pagos_credito.cuota_id, cuotas_credito.cuota_id)
      )
      .where(
        and(
          eq(cuotas_credito.credito_id, creditoId),
          eq(cuotas_credito.pagado, false),
          lt(cuotas_credito.fecha_vencimiento, hoy.toISOString().slice(0, 10)),
          sql`NOT EXISTS (
            SELECT 1
            FROM ${SQL_CARTERA_SCHEMA}.pagos_credito p_pending
            WHERE p_pending.cuota_id = ${cuotas_credito.cuota_id}
              AND p_pending.validation_status = 'pending'
              AND p_pending.pagado = true
          )`
        )
      )
      .orderBy(asc(cuotas_credito.numero_cuota));

    const cuotasPendientes = await db
      .select({
        cuota_id: cuotas_credito.cuota_id,
        credito_id: cuotas_credito.credito_id,
        numero_cuota: cuotas_credito.numero_cuota,
        fecha_vencimiento: cuotas_credito.fecha_vencimiento,
        pagado: cuotas_credito.pagado,
        createdAt: cuotas_credito.createdAt,
        // 🔥 Campos de pagos_credito - ABONOS
        pago_id: pagos_credito.pago_id,
        monto_boleta: pagos_credito.monto_boleta,
        abono_capital: pagos_credito.abono_capital,
        abono_interes: pagos_credito.abono_interes,
        abono_iva_12: pagos_credito.abono_iva_12,
        abono_interes_ci: pagos_credito.abono_interes_ci,
        abono_iva_ci: pagos_credito.abono_iva_ci,
        abono_seguro: pagos_credito.abono_seguro,
        abono_gps: pagos_credito.abono_gps,
        abono_membresias: pagos_credito.membresias_mes,

        // 🔥 RESTANTES
        capital_restante: pagos_credito.capital_restante,
        interes_restante: pagos_credito.interes_restante,
        iva_12_restante: pagos_credito.iva_12_restante,
        seguro_restante: pagos_credito.seguro_restante,
        gps_restante: pagos_credito.gps_restante,
        membresias_restante: pagos_credito.membresias,
        pago_mora: pagos_credito.mora,
        pago_otros: pagos_credito.otros,
      })
      .from(cuotas_credito)
      .innerJoin(
        pagos_credito,
        eq(pagos_credito.cuota_id, cuotas_credito.cuota_id)
      )
      .leftJoin(
        convenios_pagos_resume,
        eq(convenios_pagos_resume.pago_id, pagos_credito.pago_id)
      )
      .where(
        and(
          eq(cuotas_credito.credito_id, creditoId),
          eq(cuotas_credito.pagado, false),
          sql`NOT EXISTS (
            SELECT 1
            FROM ${SQL_CARTERA_SCHEMA}.pagos_credito p_pending
            WHERE p_pending.cuota_id = ${cuotas_credito.cuota_id}
              AND p_pending.validation_status = 'pending'
          )`
        )
      )
      .orderBy(cuotas_credito.numero_cuota);

    // 6. Consultar si la cuota actual ya fue pagada
    const cuotaActualDataResult = await db
      .select({
        cuota_id: cuotas_credito.cuota_id,
        credito_id: cuotas_credito.credito_id,
        numero_cuota: cuotas_credito.numero_cuota,
        fecha_vencimiento: cuotas_credito.fecha_vencimiento,
        pagado: cuotas_credito.pagado,
        createdAt: cuotas_credito.createdAt,
        validationStatus: pagos_credito.validationStatus,
        // 🔥 Campos de pagos_credito - ABONOS
        pago_id: pagos_credito.pago_id,
        monto_boleta: pagos_credito.monto_boleta,
        abono_capital: pagos_credito.abono_capital,
        abono_interes: pagos_credito.abono_interes,
        abono_iva_12: pagos_credito.abono_iva_12,
        abono_interes_ci: pagos_credito.abono_interes_ci,
        abono_iva_ci: pagos_credito.abono_iva_ci,
        abono_seguro: pagos_credito.abono_seguro,
        abono_gps: pagos_credito.abono_gps,
        abono_membresias: pagos_credito.membresias_mes,

        // 🔥 RESTANTES
        capital_restante: pagos_credito.capital_restante,
        interes_restante: pagos_credito.interes_restante,
        iva_12_restante: pagos_credito.iva_12_restante,
        seguro_restante: pagos_credito.seguro_restante,
        gps_restante: pagos_credito.gps_restante,
        membresias_restante: pagos_credito.membresias,
        pago_mora: pagos_credito.mora,
        pago_otros: pagos_credito.otros,
      })
      .from(cuotas_credito)
      .innerJoin(
        pagos_credito,
        eq(pagos_credito.cuota_id, cuotas_credito.cuota_id)
      )
      .leftJoin(
        convenios_pagos_resume,
        eq(convenios_pagos_resume.pago_id, pagos_credito.pago_id)
      )
      .where(
        and(
          eq(cuotas_credito.credito_id, creditoId),
          gt(cuotas_credito.numero_cuota, 0),
          gte(cuotas_credito.fecha_vencimiento, hoy.toISOString().slice(0, 10))
        )
      )
      .orderBy(cuotas_credito.fecha_vencimiento)
      .limit(1);

    // 🔥 VALIDACIÓN: Si no hay cuota actual, retornar datos sin cuota activa
    if (!cuotaActualDataResult || cuotaActualDataResult.length === 0) {
      return {
        flujo: "ACTIVO",
        credito: currentCredit.creditos,
        usuario: currentCredit.usuarios,
        cuotaActual: null,
        cuotaActualPagada: false,
        cuotaActualStatus: null,
        cuotasPendientes,
        cuotasAtrasadas,
        cuotasPagadas,
        moraActual: 0,
        mora: null,
        convenioActivo: null,
        cuotasEnConvenio: [],
        pagosConvenio: [],
      };
    }

    const cuotaActualData = cuotaActualDataResult[0];

    // ¿Está pagada la cuota actual?
    const cuotaActualPagada = !!(cuotaActualData && cuotaActualData.pagado);
    console.log("cuotaActualData", cuotaActualData);

    // La cuota actual del mes con toda su info
    const cuotaActual = cuotaActualData;
    const cuotaActualStatus = cuotaActualData.validationStatus;

    const moraActual = await db
      .select()
      .from(moras_credito)
      .where(
        and(
          eq(moras_credito.credito_id, creditoId),
          eq(moras_credito.activa, true)
        )
      );

    const convenioActivo = await db
      .select()
      .from(convenios_pago)
      .where(
        and(
          eq(convenios_pago.credito_id, creditoId),
          eq(convenios_pago.activo, true),
          eq(convenios_pago.completado, false)
        )
      )
      .limit(1);

    let cuotasEnConvenio: any[] = [];
    let pagosConvenio: any[] = [];
    let cuotasConvenioMensuales: any[] = [];
    let cuotaConvenioAPagar = "0";

    if (convenioActivo.length > 0) {
      // Traer los pagos del convenio
      pagosConvenio = await db
        .select()
        .from(convenios_pagos_resume)
        .where(
          eq(convenios_pagos_resume.convenio_id, convenioActivo[0].convenio_id)
        );

      // 🔥 Traer las cuotas mensuales del convenio
      cuotasConvenioMensuales = await db
        .select()
        .from(convenio_cuotas)
        .where(eq(convenio_cuotas.convenio_id, convenioActivo[0].convenio_id))
        .orderBy(convenio_cuotas.numero_cuota);

      // Traer las cuotas que están en el convenio
      const paymentIds = pagosConvenio.map((p) => p.pago_id);

      if (paymentIds.length > 0) {
        // Primero traer los pagos para obtener los cuota_id
        const pagos = await db
          .select()
          .from(pagos_credito)
          .where(inArray(pagos_credito.pago_id, paymentIds));

        const cuotaIds = pagos.map((p) => p.cuota_id).filter((id): id is number => id !== null);

        // Luego traer las cuotas
        cuotasEnConvenio = await db
          .select()
          .from(cuotas_credito)
          .where(inArray(cuotas_credito.cuota_id, cuotaIds))
          .orderBy(asc(cuotas_credito.numero_cuota));
      }

      const ahora = new Date();
      const fechaGuatemalaString = ahora.toLocaleString("en-US", {
        timeZone: "America/Guatemala",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      });

      const [month, day, year] = fechaGuatemalaString.split(", ")[0].split("/");
      const fechaActualGuatemala = `${year}-${month}-${day}`;

      // 🔍 Buscar la cuota del mes actual desde la DB
      const cuotaDelMesResult = await db
        .select()
        .from(convenio_cuotas)
        .where(
          and(
            eq(convenio_cuotas.convenio_id, convenioActivo[0].convenio_id),
            gte(convenio_cuotas.fecha_vencimiento, fechaActualGuatemala)
          )
        )
        .orderBy(asc(convenio_cuotas.fecha_vencimiento))
        .limit(1);

      const cuotaDelMes = cuotaDelMesResult[0];
      console.log("cuotaDelMes convenio:", cuotaDelMes);

      // Si encontramos la cuota del mes y NO tiene fecha_pago, debe pagar
      if (cuotaDelMes && cuotaDelMes.fecha_pago === null) {
        cuotaConvenioAPagar = convenioActivo[0].cuota_mensual;
        console.log(
          `💰 Debe pagar cuota #${cuotaDelMes.numero_cuota} (vence: ${cuotaDelMes.fecha_vencimiento})`
        );
      } else if (cuotaDelMes && cuotaDelMes.fecha_pago) {
        cuotaConvenioAPagar = "0";
        console.log(
          `✅ Cuota #${cuotaDelMes.numero_cuota} ya está pagada el ${cuotaDelMes.fecha_pago}`
        );
      } else {
        cuotaConvenioAPagar = "0";
        console.log("📅 Aún no hay cuota vencida este mes");
      }
    }

    return {
      flujo: "ACTIVO",
      credito: currentCredit.creditos,
      usuario: currentCredit.usuarios,
      asesor: currentCredit.asesores,
      cuotaActual,
      cuotaActualPagada,
      cuotaActualStatus,
      cuotasPendientes,
      cuotasAtrasadas,
      cuotasPagadas,
      moraActual: moraActual.length > 0 ? moraActual[0].monto_mora : 0,
      mora: moraActual.length > 0 ? moraActual[0] : null,
      convenioActivo:
        convenioActivo.length > 0
          ? {
              ...convenioActivo[0],
              cuotaConvenioAPagar,
            }
          : null,
      cuotasEnConvenio,
      pagosConvenio,
    };
  } catch (error) {
    console.error("[getCreditoByNumero] Error:", error);
    return { message: "Error consultando crédito", error: String(error) };
  }
};

// Interfaces para cancelaciones/incobrables
export interface CreditCancelation {
  id: number;
  credit_id: number;
  motivo: string;
  observaciones?: string | null;
  fecha_cancelacion: Date | string;
  monto_cancelacion: number;
}

export interface BadDebt {
  id: number;
  credit_id: number;
  motivo: string;
  observaciones?: string | null;
  fecha_registro: Date | string;
  monto_incobrable: number;
}

// 🆕 Tipos para próxima cuota
type ProximidadPago = "TODAY" | "WEEK" | "TWO_WEEKS" | "MONTH" | "DUEMONTH";

interface ProximaCuota {
  cuota_id: number;
  numero_cuota: number;
  fecha_vencimiento: string;
  pagado: boolean;
  pago_id?: number;
  validation_status?: string;
  proximidad: ProximidadPago;
}

// 🔥 Interface actualizada
export interface CreditoConInfo {
  creditos: typeof creditos.$inferSelect;
  usuarios: typeof usuarios.$inferSelect;
  asesores: typeof asesores.$inferSelect;
  inversionistas: {
    credito_id: number;
    inversionista_id: number;
    nombre: string;
    emite_factura: boolean;
    monto_aportado: string;
    monto_cash_in: string;
    monto_inversionista: string;
    iva_cash_in: string;
    iva_inversionista: string;
    porcentaje_participacion_inversionista: string;
    porcentaje_cash_in: string;
    cuota_inversionista: string;
    fecha_inicio_participacion?: string;
  }[];
  resumen: {
    total_cash_in_monto: number;
    total_cash_in_iva: number;
    total_inversion_monto: number;
    total_inversion_iva: number;
  };
  cancelacion?: CreditCancelation | null;
  incobrable?: BadDebt | null;
  rubros?: { nombre_rubro: string; monto: number }[];
  mora?: any; // 👈 Este también faltaba si no lo tenías
  deuda_total_con_mora?: string; // 👈 Este también
  proxima_cuota?: ProximaCuota | null; // 🆕 NUEVO CAMPO
  creditos_inversionistas_espejo?: {
    credito_id: number;
    inversionista_id: number;
    nombre: string;
    monto_aportado: string;
    porcentaje_participacion: string;
    porcentaje_cash_in: string;
    porcentaje_inversion: string;
    monto_cash_in: string;
    monto_inversionista: string;
    cuota_inversionista: string;
    fecha_inicio_participacion?: string;
  }[];
  fecha_inicio?: string | null;
  /** Nombre de la aseguradora vinculada al crédito (null si no tiene). */
  aseguradora?: string | null;
  /** Bucket de cobros actual (B0-B5), derivado del catálogo dinámico. null = fuera del funnel operativo. */
  bucket?: {
    numero: number;
    prefijo: string;
    nombre: string;
    color: string | null;
  } | null;
}

// 🔥 Función auxiliar para calcular proximidad (con zona horaria de Guatemala)
function calcularProximidad(fechaVencimiento: string): ProximidadPago {
  // 🇬🇹 Hora de Guatemala
  const hoy = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Guatemala" })
  );
  hoy.setHours(0, 0, 0, 0);

  // 🔥 Parsear fecha como local, no UTC (evita desfase de timezone)
  const [year, month, day] = fechaVencimiento.slice(0, 10).split("-").map(Number);
  const vencimiento = new Date(year, month - 1, day);
  vencimiento.setHours(0, 0, 0, 0);

  const diffDays = Math.floor(
    (vencimiento.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays === 0) return "TODAY";
  if (diffDays > 0 && diffDays <= 7) return "WEEK";
  if (diffDays > 7 && diffDays <= 14) return "TWO_WEEKS";
  if (diffDays > 14 && diffDays <= 30) return "MONTH";

  return "DUEMONTH";
}

export async function getCreditosWithUserByMesAnio(
  mes: number,
  anio: number,
  page: number = 1,
  perPage: number = 10,
  numero_credito_sifco?: string,
  estado?:
    | "ACTIVO"
    | "CANCELADO"
    | "INCOBRABLE"
    | "PENDIENTE_CANCELACION"
    | "MOROSO"
    | "EN_CONVENIO"
    | "CAIDO",
  asesor_id?: number,
  nombre_usuario?: string,
  email_asesor?: string,
  cuotas_atrasadas?: number,
  proximidad_pago?: ProximidadPago,
  is_vehiculo_propio?: boolean,
  inversionista_ids?: number[],
  fecha_desde?: string,
  fecha_hasta?: string,
  numeros_credito_sifco?: string[],
  capital_min?: number,
  capital_max?: number,
  estados_credito?: StatusCredit[],
  aseguradora_id?: number,
  // Filtro por rango de cuotas atrasadas (aging). Reemplaza al escalar
  // `cuotas_atrasadas` (que sólo hacía `= N`). Si se envían, tienen prioridad.
  // `cuotas_max` undefined = sin tope (>= cuotas_min).
  cuotas_min?: number,
  cuotas_max?: number,
  // 🪣 COBROS-02: filtro por BUCKET (números del catálogo, ej. [1] o [4,5]).
  // El bucket (filtro Y columna de la respuesta) viene SIEMPRE del MOTOR: el
  // último registrado en buckets_historial. Es estable — solo cambia cuando el
  // job registra la transición (con su reasignación de asesor) — así un admin
  // nunca ve saltos sin evento (la derivación viva parpadeaba a B0 al registrar
  // un pago, ventana "mora apagada"). Fallback al derivado vivo SOLO para
  // créditos que el motor aún no vio (sin INICIAL — p.ej. ambientes donde las
  // migraciones cobros-02 no se han aplicado; ahí el try/catch degrada solo).
  buckets_numeros?: number[],
  excluir_pagados_mes?: boolean
): Promise<{
  data: CreditoConInfo[];
  page: number;
  perPage: number;
  totalCount: number;
  totalPages: number;
}> {
  console.log(
    `🚀 Fetching credits | mes: ${mes}, anio: ${anio}, page: ${page}, perPage: ${perPage}`
  );

  const offset = (page - 1) * perPage;
  const conditions: any[] = [];

  // 🇬🇹 Fecha actual en Guatemala. sv-SE da directamente YYYY-MM-DD y no
  // depende del TZ del proceso (el patrón anterior new Date(toLocaleString)
  // + toISOString solo era correcto con el server en UTC).
  const hoyStr = new Date().toLocaleDateString("sv-SE", {
    timeZone: "America/Guatemala",
  });
  // Aritmética de días en espacio UTC puro (independiente del TZ del server).
  const hoyUTC = new Date(`${hoyStr}T00:00:00Z`);
  const sumarDiasStr = (dias: number) => {
    const d = new Date(hoyUTC);
    d.setUTCDate(d.getUTCDate() + dias);
    return d.toISOString().slice(0, 10);
  };

  try {
    // 📌 Filtros
    // Normalizar lista multi-SIFCO (tiene prioridad sobre el filtro single).
    const sifcosLimpios = numeros_credito_sifco
      ?.map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (sifcosLimpios && sifcosLimpios.length > 0) {
      console.log(
        `🔎 Filtrando por ${sifcosLimpios.length} número(s) de crédito (multi)`
      );
      conditions.push(inArray(creditos.numero_credito_sifco, sifcosLimpios));
    } else if (numero_credito_sifco && numero_credito_sifco.trim().length > 0) {
      console.log(`🔎 Filtrando por número de crédito: ${numero_credito_sifco}`);
      conditions.push(eq(creditos.numero_credito_sifco, numero_credito_sifco.trim()));
    } else {
      if (mes !== 0 && anio !== 0) {
        console.log(`🔎 Filtrando por mes/año: ${mes}/${anio}`);
        conditions.push(
          sql`EXTRACT(MONTH FROM ${creditos.fecha_creacion} AT TIME ZONE 'America/Guatemala') = ${mes}`,
          sql`EXTRACT(YEAR FROM ${creditos.fecha_creacion} AT TIME ZONE 'America/Guatemala') = ${anio}`
        );
      }
    }

    // Rango efectivo de cuotas atrasadas. Prioriza el rango nuevo (cuotas_min/max);
    // si sólo llega el escalar viejo `cuotas_atrasadas`, lo trata como min=max (=N).
    const cuotasMinEff =
      cuotas_min !== undefined ? cuotas_min : cuotas_atrasadas;
    const cuotasMaxEff =
      cuotas_max !== undefined
        ? cuotas_max
        : cuotas_min !== undefined
          ? undefined // rango abierto (>= min) cuando se pidió min sin max
          : cuotas_atrasadas; // escalar viejo => exacto

    // "Al día" = exactamente 0 cuotas atrasadas.
    const esAlDia = cuotasMinEff === 0 && cuotasMaxEff === 0;

    if (estado && estado.length > 0) {
      if (estado === "ACTIVO") {
        console.log(`🔎 Filtrando por estado: ACTIVO + MOROSO`);
        if (esAlDia) {
          conditions.push(sql`${creditos.statusCredit} IN ('ACTIVO')`);
        } else {
          conditions.push(sql`${creditos.statusCredit} IN ('ACTIVO', 'MOROSO', 'EN_CONVENIO')`);
        }
      } else {
        console.log(`🔎 Filtrando por estado: ${estado}`);
        conditions.push(eq(creditos.statusCredit, estado));
      }
    }

    if (estados_credito && estados_credito.length > 0) {
      console.log(`🔎 Filtrando por estados seleccionables: ${estados_credito.join(", ")}`);
      conditions.push(inArray(creditos.statusCredit, estados_credito));
    }

    if (asesor_id) {
      console.log(`🔎 Filtrando por asesor_id: ${asesor_id}`);
      conditions.push(eq(creditos.asesor_id, asesor_id));
    }

    if (nombre_usuario && nombre_usuario.trim().length > 0) {
      console.log(`🔎 Filtrando por nombre de usuario: ${nombre_usuario}`);
      const nameCond = buildNameSearchCondition(usuarios.nombre, nombre_usuario);
      if (nameCond) conditions.push(nameCond);
    }

    if (email_asesor && email_asesor.trim().length > 0) {
      console.log(`🔎 Filtrando por email de asesor: ${email_asesor}`);
      conditions.push(
        sql`${asesores.emailCashIn} ILIKE ${`%${email_asesor}%`}`
      );
    }

    // Filtro por rango de cuotas atrasadas (rangos definidos en el catálogo
    // dinámico `cartera.buckets`). Reemplaza el filtro escalar `cuotas_atrasadas`
    // que COBROS-02 arreglaba con un hack `>= 4` solo para el 120+: el rango
    // soporta B4 exacto (=4) y B5 abierto (>=5) de forma parametrizable.
    // `esAlDia` (0..0) se resuelve arriba vía el estado; aquí sólo aplicamos
    // cuando hay mora (min > 0).
    if (cuotasMinEff !== undefined && cuotasMinEff > 0) {
      conditions.push(gte(moras_credito.cuotas_atrasadas, cuotasMinEff));
      if (cuotasMaxEff !== undefined) {
        console.log(
          `🔎 Filtrando por cuotas atrasadas entre ${cuotasMinEff} y ${cuotasMaxEff}`
        );
        conditions.push(lte(moras_credito.cuotas_atrasadas, cuotasMaxEff));
      } else {
        console.log(`🔎 Filtrando por cuotas atrasadas >= ${cuotasMinEff}`);
      }
    }

    if (is_vehiculo_propio) {
      console.log(`🔎 Filtrando solo vehículos propios`);
      conditions.push(eq(creditos.is_vehiculo_propio, true));
    }

    if (inversionista_ids && inversionista_ids.length > 0) {
      console.log(`🔎 Filtrando por inversionistas: ${inversionista_ids}`);
      conditions.push(
        inArray(creditos_inversionistas.inversionista_id, inversionista_ids)
      );
    }
  } catch (err) {
    console.error("❌ Error construyendo filtros:", err);
    throw new Error("Error building filters");
  }

  // 🔥 Filtro de proximidad_pago / rango de fechas - se aplica ANTES de la paginación
  const needsProximidadJoin = !!proximidad_pago || !!fecha_desde || !!fecha_hasta;
  if (proximidad_pago) {
    console.log(`🔎 Filtrando por proximidad de pago: ${proximidad_pago}`);

    // Calcular rangos de fecha según proximidad (derivados de hoyStr para no
    // depender del TZ del proceso)
    if (proximidad_pago === "TODAY") {
      conditions.push(sql`${cuotas_credito.fecha_vencimiento}::date = ${hoyStr}::date`);
    } else if (proximidad_pago === "WEEK") {
      const finStr = sumarDiasStr(7);
      conditions.push(sql`${cuotas_credito.fecha_vencimiento}::date > ${hoyStr}::date`);
      conditions.push(sql`${cuotas_credito.fecha_vencimiento}::date <= ${finStr}::date`);
    } else if (proximidad_pago === "TWO_WEEKS") {
      const inicioStr = sumarDiasStr(8);
      const finStr = sumarDiasStr(14);
      conditions.push(sql`${cuotas_credito.fecha_vencimiento}::date >= ${inicioStr}::date`);
      conditions.push(sql`${cuotas_credito.fecha_vencimiento}::date <= ${finStr}::date`);
    } else if (proximidad_pago === "MONTH") {
      const inicioStr = sumarDiasStr(15);
      const finStr = sumarDiasStr(30);
      conditions.push(sql`${cuotas_credito.fecha_vencimiento}::date >= ${inicioStr}::date`);
      conditions.push(sql`${cuotas_credito.fecha_vencimiento}::date <= ${finStr}::date`);
    } else if (proximidad_pago === "DUEMONTH") {
      const inicioStr = sumarDiasStr(31);
      conditions.push(sql`${cuotas_credito.fecha_vencimiento}::date >= ${inicioStr}::date`);
    }

    // Solo cuotas no pagadas y con numero > 0
    conditions.push(eq(cuotas_credito.pagado, false));
    conditions.push(gt(cuotas_credito.numero_cuota, 0));
  }

  if (fecha_desde || fecha_hasta) {
    if (!proximidad_pago) {
      conditions.push(eq(cuotas_credito.pagado, false));
      conditions.push(gt(cuotas_credito.numero_cuota, 0));
    }
    if (fecha_desde) {
      conditions.push(sql`${cuotas_credito.fecha_vencimiento}::date >= ${fecha_desde}::date`);
    }
    if (fecha_hasta) {
      conditions.push(sql`${cuotas_credito.fecha_vencimiento}::date <= ${fecha_hasta}::date`);
    }
  }


  if (capital_min !== undefined) {
    conditions.push(sql`${creditos.capital}::numeric >= ${capital_min}`);
  }
  if (capital_max !== undefined) {
    conditions.push(sql`${creditos.capital}::numeric <= ${capital_max}`);
  }

  if (aseguradora_id !== undefined) {
    conditions.push(eq(creditos.aseguradora_id, aseguradora_id));
  }

  // 🪣 COBROS-02: filtro por BUCKET (B0-B5). Fuera del funnel queda excluido
  // SIEMPRE. El bucket = COALESCE(último de buckets_historial, derivación viva
  // con las reglas de bucketDeCredito: estados_incluidos manda → INCOBRABLE a
  // B5; luego rango de cuotas de la mora activa; sin mora = 0 → B0). El
  // fallback vivo solo aplica a créditos sin INICIAL (el motor no los ha visto).
  if (buckets_numeros && buckets_numeros.length > 0) {
    console.log(`🔎 Filtrando por bucket(s) [motor]: ${buckets_numeros.join(", ")}`);
    const numerosSql = sql.join(buckets_numeros.map((n) => sql`${n}`), sql`, `);
    const fueraSql = sql.join(STATUS_BUCKET_FUERA.map((s) => sql`${s}`), sql`, `);
    conditions.push(sql`${creditos.statusCredit} NOT IN (${fueraSql})`);
    conditions.push(sql`COALESCE(
      (SELECT h.bucket_nuevo FROM ${SQL_CARTERA_SCHEMA}.buckets_historial h
        WHERE h.credito_id = ${creditos.credito_id}
        ORDER BY h.fecha DESC, h.historial_id DESC
        LIMIT 1),
      (SELECT b.numero FROM ${SQL_CARTERA_SCHEMA}.buckets b
        WHERE b.activo = true
          AND ${creditos.statusCredit} = ANY (b.estados_incluidos)
        ORDER BY b.numero LIMIT 1),
      (SELECT b.numero FROM ${SQL_CARTERA_SCHEMA}.buckets b
        WHERE b.activo = true
          AND COALESCE(${moras_credito.cuotas_atrasadas}, 0) >= b.cuotas_min
          AND (b.cuotas_max IS NULL OR COALESCE(${moras_credito.cuotas_atrasadas}, 0) <= b.cuotas_max)
        ORDER BY b.numero LIMIT 1)
    ) IN (${numerosSql})`);
  }

  if (excluir_pagados_mes) {
    console.log(`🔎 Excluyendo créditos con su cuota actual ya pagada`);
    // Cuota actual = la MISMA cuota que la tabla muestra como Fecha de Pago
    // (proximasCuotasMap): primera cuota con fecha_vencimiento >= (fecha_desde
    // ?? hoy), con tope fecha_hasta si hay rango — si las anclas divergen, un
    // crédito con cuota impaga visible podría ocultarse. Se excluye el crédito
    // solo si esa cuota está pagada (todas sus filas, por si hay duplicadas)
    // Y no tiene mora activa; sin cuotas en el rango no se excluye.
    // Subconsulta correlacionada en vez de join para no multiplicar filas
    // (paginación) y para que el COUNT herede la condición.
    const anclaDesde = fecha_desde ?? hoyStr;
    conditions.push(sql`NOT (
      ${moras_credito.credito_id} IS NULL
      AND COALESCE((
        SELECT bool_and(COALESCE(cc.pagado, false))
        FROM ${cuotas_credito} cc
        WHERE cc.credito_id = ${creditos.credito_id}
          AND cc.numero_cuota > 0
          AND cc.fecha_vencimiento = (
            SELECT MIN(cc2.fecha_vencimiento)
            FROM ${cuotas_credito} cc2
            WHERE cc2.credito_id = ${creditos.credito_id}
              AND cc2.numero_cuota > 0
              AND cc2.fecha_vencimiento >= ${anclaDesde}::date
              ${fecha_hasta ? sql`AND cc2.fecha_vencimiento <= ${fecha_hasta}::date` : sql``}
          )
      ), false)
    )`);
  }

  const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

  let rows: any[] = [];
  try {
    // 1️⃣ 🔥 QUERY OPTIMIZADO - Buscar créditos únicos
    let query = db
      .select({
        creditos,
        usuarios,
        asesores,
        moras_credito,
        aseguradora_nombre: aseguradoras.nombre,
      })
      .from(creditos)
      .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .innerJoin(asesores, eq(creditos.asesor_id, asesores.asesor_id))
      .leftJoin(
        moras_credito,
        and(
          eq(creditos.credito_id, moras_credito.credito_id),
          eq(moras_credito.activa, true) // 🔥 Solo moras activas
        )
      )
      .leftJoin(aseguradoras, eq(creditos.aseguradora_id, aseguradoras.id));

    // 🔥 JOIN con cuotas_credito si filtramos por proximidad
    if (needsProximidadJoin) {
      query = query.innerJoin(
        cuotas_credito,
        eq(creditos.credito_id, cuotas_credito.credito_id)
      ) as any;
    }

    // 🔥 JOIN con creditos_inversionistas si filtramos por inversionistas
    if (inversionista_ids && inversionista_ids.length > 0) {
      query = query.innerJoin(
        creditos_inversionistas,
        eq(creditos.credito_id, creditos_inversionistas.credito_id)
      ) as any;
    }

    rows = await query
      .where(whereCondition)
      .limit(perPage)
      .offset(offset)
      .orderBy(desc(creditos.fecha_creacion));

    console.log(`📄 Créditos encontrados: ${rows.length}`);
  } catch (err) {
    console.error("❌ Error consultando créditos:", err);
    throw new Error("Error fetching credits");
  }

  // 🆔 IDs únicos de créditos
  const creditosIds = [...new Set(rows.map((r) => r.creditos.credito_id))];
  console.log("🆔 Créditos IDs únicos:", creditosIds);

  // 2️⃣ Rubros
  let rubrosMap: Record<number, { nombre_rubro: string; monto: number }[]> = {};
  if (creditosIds.length > 0) {
    try {
      const rubrosPorCredito = await db
        .select({
          credito_id: creditos_rubros_otros.credito_id,
          nombre_rubro: creditos_rubros_otros.nombre_rubro,
          monto: creditos_rubros_otros.monto,
        })
        .from(creditos_rubros_otros)
        .where(inArray(creditos_rubros_otros.credito_id, creditosIds));

      console.log(`📊 Rubros encontrados: ${rubrosPorCredito.length}`);

      // 🔥 Agrupar por credito_id
      rubrosMap = rubrosPorCredito.reduce((acc, r) => {
        if (!acc[r.credito_id]) {
          acc[r.credito_id] = [];
        }
        acc[r.credito_id].push({
          nombre_rubro: r.nombre_rubro,
          monto: Number(r.monto),
        });
        return acc;
      }, {} as Record<number, { nombre_rubro: string; monto: number }[]>);
    } catch (err) {
      console.error("❌ Error consultando rubros:", err);
    }
  }

  // 3️⃣ 🔥 INVERSIONISTAS - Optimizado
  let inversionistasMap: Record<number, any> = {};
  let inversionistasEspejoMap: Record<number, any[]> = {}; // 🆕 Mapa para Espejos

  if (creditosIds.length > 0) {
    try {
      // 3.1 Inversionistas Normales (Ordenados por ID para consistencia)
      const inversionistasPorCredito = await db
        .select({
          credito_id: creditos_inversionistas.credito_id,
          inversionista_id: inversionistas.inversionista_id,
          nombre: inversionistas.nombre,
          emite_factura: inversionistas.emite_factura,
          monto_aportado: creditos_inversionistas.monto_aportado,
          monto_cash_in: creditos_inversionistas.monto_cash_in,
          monto_inversionista: creditos_inversionistas.monto_inversionista,
          iva_cash_in: creditos_inversionistas.iva_cash_in,
          iva_inversionista: creditos_inversionistas.iva_inversionista,
          porcentaje_participacion_inversionista:
            creditos_inversionistas.porcentaje_participacion_inversionista,
          porcentaje_cash_in: creditos_inversionistas.porcentaje_cash_in,
          cuota_inversionista: creditos_inversionistas.cuota_inversionista,
          fecha_inicio_participacion: creditos_inversionistas.fecha_inicio_participacion,
        })
        .from(creditos_inversionistas)
        .innerJoin(
          inversionistas,
          eq(
            creditos_inversionistas.inversionista_id,
            inversionistas.inversionista_id
          )
        )
        .where(inArray(creditos_inversionistas.credito_id, creditosIds))
        .orderBy(asc(creditos_inversionistas.id)); // 👈 Orden garantizado

      // 3.2 Inversionistas Espejo (Ordenados por ID para consistencia)
      const inversionistasEspejoPorCredito = await db
        .select({
          credito_id: creditos_inversionistas_espejo.credito_id,
          inversionista_id: inversionistas.inversionista_id,
          nombre: inversionistas.nombre,
          monto_aportado: creditos_inversionistas_espejo.monto_aportado,
          porcentaje_participacion: sql<string>`'0'`, // Calculado en frontend
          porcentaje_cash_in: creditos_inversionistas_espejo.porcentaje_cash_in,
          porcentaje_inversion:
            creditos_inversionistas_espejo.porcentaje_participacion_inversionista,
          monto_cash_in: creditos_inversionistas_espejo.monto_cash_in,
          monto_inversionista:
            creditos_inversionistas_espejo.monto_inversionista,
          cuota_inversionista:
            creditos_inversionistas_espejo.cuota_inversionista,
          fecha_inicio_participacion:
            creditos_inversionistas_espejo.fecha_inicio_participacion,
        })
        .from(creditos_inversionistas_espejo)
        .innerJoin(
          inversionistas,
          eq(
            creditos_inversionistas_espejo.inversionista_id,
            inversionistas.inversionista_id
          )
        )
        .where(inArray(creditos_inversionistas_espejo.credito_id, creditosIds))
        .orderBy(asc(creditos_inversionistas_espejo.id)); // 👈 Orden garantizado

      // 3.3 Mapeo Normales
      inversionistasMap = creditosIds.reduce(
        (acc, creditoId) => {
          const aportes = inversionistasPorCredito.filter(
            (inv) => inv.credito_id === creditoId
          );

          acc[creditoId] = {
            aportes,
            resumen: {
              total_cash_in_monto: aportes.reduce(
                (sum, cur) => sum + Number(cur.monto_cash_in ?? 0),
                0
              ),
              total_cash_in_iva: aportes.reduce(
                (sum, cur) => sum + Number(cur.iva_cash_in ?? 0),
                0
              ),
              total_inversion_monto: aportes.reduce(
                (sum, cur) => sum + Number(cur.monto_inversionista ?? 0),
                0
              ),
              total_inversion_iva: aportes.reduce(
                (sum, cur) => sum + Number(cur.iva_inversionista ?? 0),
                0
              ),
            },
          };
          return acc;
        },
        {} as Record<number, any>
      );

      // 3.4 Mapeo Espejos
      inversionistasEspejoMap = creditosIds.reduce(
        (acc, creditoId) => {
          const aportesEspejo = inversionistasEspejoPorCredito.filter(
            (inv) => inv.credito_id === creditoId
          );
          acc[creditoId] = aportesEspejo;
          return acc;
        },
        {} as Record<number, any[]>
      );
    } catch (err) {
      console.error("❌ Error consultando inversionistas:", err);
    }
  }

  // 4️⃣ Moras Map
  const morasMap: Record<number, any> = {};
  rows.forEach((row) => {
    if (row.moras_credito) {
      morasMap[row.creditos.credito_id] = row.moras_credito;
    }
  });

  // 4️⃣.5 Catálogo de buckets (dinámico, cartera.buckets) — para derivar el
  // bucket (B0-B5) de cada crédito. Mismo criterio que el motor de COBROS-02
  // (bucketDeCredito en latefee.ts), pero sin tocar buckets_historial.
  type BucketDisplay = {
    numero: number;
    prefijo: string;
    nombre: string;
    color: string | null;
  };
  let catalogoBuckets: BucketCatalogo[] = [];
  const bucketDisplayMap = new Map<number, BucketDisplay>();

  // Degradar a clasificación + display por cuotas (fallback) en vez de dejar
  // `catalogoBuckets`/`bucketDisplayMap` vacíos — sin esto la columna Bucket
  // sale en blanco aunque la clasificación por cuotas siga funcionando.
  const aplicarFallbackBuckets = () => {
    catalogoBuckets = FALLBACK_BUCKETS_CUOTAS.map((b) => ({
      numero: b.numero,
      cuotas_min: b.cuotas_min,
      cuotas_max: b.cuotas_max,
      estados_incluidos: b.estados_incluidos,
    }));
    FALLBACK_BUCKETS_CUOTAS.forEach((b) => {
      bucketDisplayMap.set(b.numero, {
        numero: b.numero,
        prefijo: b.prefijo,
        nombre: b.nombre,
        color: null,
      });
    });
  };

  try {
    const catalogoRows = await getBucketsCatalogo();

    if (catalogoRows.length > 0) {
      catalogoBuckets = catalogoRows.map((b) => ({
        numero: b.numero,
        cuotas_min: b.cuotas_min,
        cuotas_max: b.cuotas_max,
        estados_incluidos: b.estados_incluidos,
      }));
      catalogoRows.forEach((b) => {
        bucketDisplayMap.set(b.numero, {
          numero: b.numero,
          prefijo: b.prefijo,
          nombre: b.nombre,
          color: b.color,
        });
      });
    } else {
      // Catálogo vacío (migración pendiente).
      aplicarFallbackBuckets();
    }
  } catch (err) {
    console.error("❌ Error cargando catálogo de buckets:", err);
    aplicarFallbackBuckets();
  }

  // 4️⃣.6 Último bucket registrado por crédito (buckets_historial) — la columna
  // `bucket` dice lo MISMO que el filtro (la verdad del motor, no la derivación
  // viva). 1 query por página de créditos. Si la tabla no existe (migraciones
  // cobros-02 pendientes en ese ambiente), el catch deja el map vacío y todo
  // cae al derivado vivo — mismo comportamiento de siempre.
  const ultimoBucketMap = new Map<number, number>();
  if (creditosIds.length > 0) {
    try {
      const idsSql = sql.join(creditosIds.map((id) => sql`${id}`), sql`, `);
      const ultimos = await db.execute<{ credito_id: number; bucket_nuevo: number }>(sql`
        SELECT DISTINCT ON (credito_id) credito_id, bucket_nuevo
        FROM ${SQL_CARTERA_SCHEMA}.buckets_historial
        WHERE credito_id IN (${idsSql})
        ORDER BY credito_id, fecha DESC, historial_id DESC`);
      for (const r of ultimos.rows) {
        ultimoBucketMap.set(Number(r.credito_id), Number(r.bucket_nuevo));
      }
    } catch (err) {
      console.error("❌ Error cargando último bucket (motor):", err);
    }
  }

  // 5️⃣ Próximas cuotas
  let proximasCuotasMap: Record<number, ProximaCuota> = {};
  if (creditosIds.length > 0) {
    try {
      console.log("🔍 Buscando próximas cuotas...");

      const cuotasRaw = await db
        .select({
          credito_id: cuotas_credito.credito_id,
          cuota_id: cuotas_credito.cuota_id,
          numero_cuota: cuotas_credito.numero_cuota,
          fecha_vencimiento: cuotas_credito.fecha_vencimiento,
          pagado: cuotas_credito.pagado,
          pago_id: pagos_credito.pago_id,
          validation_status: pagos_credito.validationStatus,
        })
        .from(cuotas_credito)
        .leftJoin(
          pagos_credito,
          eq(cuotas_credito.cuota_id, pagos_credito.cuota_id)
        )
        .where(
          and(
            inArray(cuotas_credito.credito_id, creditosIds),
            gte(cuotas_credito.fecha_vencimiento, fecha_desde ?? hoyStr),
            fecha_hasta ? lte(cuotas_credito.fecha_vencimiento, fecha_hasta) : undefined,
            gt(cuotas_credito.numero_cuota, 0)
          )
        )
        .orderBy(cuotas_credito.credito_id, cuotas_credito.fecha_vencimiento);

      console.log(`📅 Cuotas encontradas: ${cuotasRaw.length}`);

      // 🔥 Solo la primera cuota de cada crédito
      const cuotasPorCredito = new Map<number, any>();
      cuotasRaw.forEach((cuota) => {
        if (!cuotasPorCredito.has(cuota.credito_id)) {
          cuotasPorCredito.set(cuota.credito_id, cuota);
        }
      });

      cuotasPorCredito.forEach((cuota, creditoId) => {
        proximasCuotasMap[creditoId] = {
          cuota_id: cuota.cuota_id,
          numero_cuota: cuota.numero_cuota,
          fecha_vencimiento: cuota.fecha_vencimiento,
          pagado: cuota.pagado,
          pago_id: cuota.pago_id,
          validation_status: cuota.validation_status,
          proximidad: calcularProximidad(cuota.fecha_vencimiento),
        };
      });

      console.log(`📅 Próximas cuotas mapeadas: ${cuotasPorCredito.size}`);
    } catch (err) {
      console.error("❌ Error consultando próximas cuotas:", err);
    }
  }

  // 5.5 Fecha de inicio (cuota 1) de cada crédito
  let fechaInicioMap: Record<number, string> = {};
  if (creditosIds.length > 0) {
    try {
      const cuotasUno = await db
        .select({
          credito_id: cuotas_credito.credito_id,
          fecha_vencimiento: cuotas_credito.fecha_vencimiento,
        })
        .from(cuotas_credito)
        .where(
          and(
            inArray(cuotas_credito.credito_id, creditosIds),
            eq(cuotas_credito.numero_cuota, 1)
          )
        );

      cuotasUno.forEach((c) => {
        fechaInicioMap[c.credito_id] = c.fecha_vencimiento as string;
      });
    } catch (err) {
      console.error("Error consultando fecha inicio:", err);
    }
  }

  // 6️⃣ Cancelaciones & Incobrables
  let cancelacionesMap: Record<number, CreditCancelation> = {};
  let incobrablesMap: Record<number, BadDebt> = {};

  try {
    const canceladosIds = rows
      .filter((r) => r.creditos.statusCredit === "CANCELADO")
      .map((r) => r.creditos.credito_id);
      
    if (canceladosIds.length > 0) {
      console.log("🛑 Créditos cancelados:", canceladosIds.length);
      const cancelacionesRaw = await db
        .select()
        .from(credit_cancelations)
        .where(
          and(
            inArray(credit_cancelations.credit_id, canceladosIds), 
          )
        );
        
      cancelacionesRaw.forEach((row) => {
        cancelacionesMap[row.credit_id] = {
          ...row,
          fecha_cancelacion: row.fecha_cancelacion ?? "",
          monto_cancelacion: Number(row.monto_cancelacion),
        };
      });
    }
  } catch (err) {
    console.error("❌ Error consultando cancelaciones:", err);
  }

  try {
    const incobrablesIds = rows
      .filter((r) => r.creditos.statusCredit === "INCOBRABLE")
      .map((r) => r.creditos.credito_id);
      
    if (incobrablesIds.length > 0) {
      console.log("⚠️ Créditos incobrables:", incobrablesIds.length);
      const incobrablesRaw = await db
        .select()
        .from(bad_debts)
        .where(inArray(bad_debts.credit_id, incobrablesIds));
        
      incobrablesRaw.forEach((row) => {
        incobrablesMap[row.credit_id] = {
          ...row,
          fecha_registro: row.fecha_registro ?? "",
          monto_incobrable: Number(row.monto_incobrable),
        };
      });
    }
  } catch (err) {
    console.error("❌ Error consultando incobrables:", err);
  }

  // 7️⃣ 🔥 MAP FINAL - Sin duplicados
  let data: CreditoConInfo[] = [];
  try {
    // 🔥 Usar Map para asegurar créditos únicos
    const creditosUnicos = new Map<number, any>();
    
    rows.forEach((row) => {
      const creditoId = row.creditos.credito_id;
      
      // Solo agregar si no existe
      if (!creditosUnicos.has(creditoId)) {
        const info = inversionistasMap[creditoId] || {
          aportes: [],
          resumen: {
            total_cash_in_monto: 0,
            total_cash_in_iva: 0,
            total_inversion_monto: 0,
            total_inversion_iva: 0,
          },
        };
        
        const rubros = rubrosMap[creditoId] || [];
        const cancelacion = row.creditos.statusCredit === "CANCELADO"
          ? cancelacionesMap[creditoId] || null
          : undefined;
        const incobrable = row.creditos.statusCredit === "INCOBRABLE"
          ? incobrablesMap[creditoId] || null
          : undefined;

        const mora = morasMap[creditoId] || null;
        const deuda_total_con_mora = new Big(row.creditos.deudatotal ?? 0)
          .plus(new Big(mora?.monto_mora ?? 0))
          .toString();

        const proxima_cuota = proximasCuotasMap[creditoId] || null;
        const fecha_inicio = fechaInicioMap[creditoId] || null;

        // Último bucket del motor; fallback al derivado vivo solo si el motor
        // aún no vio el crédito (sin INICIAL). Fuera del funnel NO se consulta
        // el historial (review Codex): un crédito que tuvo bucket y luego pasó
        // a CANCELADO/EN_CONVENIO/etc. conservaría su último bucket como
        // zombie — el motor ya no lo trackea, así que bucket = null.
        const fueraDelFunnel = STATUS_BUCKET_FUERA.includes(
          row.creditos.statusCredit,
        );
        const numeroBucket = fueraDelFunnel
          ? null
          : ultimoBucketMap.get(creditoId) ??
            bucketDeCredito(
              row.creditos.statusCredit,
              mora?.cuotas_atrasadas ?? 0,
              catalogoBuckets,
            );
        const bucket =
          numeroBucket == null ? null : bucketDisplayMap.get(numeroBucket) ?? null;

        creditosUnicos.set(creditoId, {
          creditos: row.creditos,
          usuarios: row.usuarios,
          asesores: row.asesores,
          inversionistas: info.aportes,
          creditos_inversionistas_espejo: inversionistasEspejoMap[creditoId] || [], // 👈 Agregado aquí
          resumen: info.resumen,
          cancelacion,
          rubros,
          incobrable,
          mora,
          deuda_total_con_mora,
          proxima_cuota,
          fecha_inicio,
          aseguradora: row.aseguradora_nombre ?? null,
          bucket,
        });
      }
    });

    data = Array.from(creditosUnicos.values());
    console.log(`✅ Créditos únicos mapeados: ${data.length}`);
  } catch (err) {
    console.error("❌ Error mapeando créditos:", err);
    throw new Error("Error mapping credits");
  }

  // 8️⃣ Filtro de proximidad - YA SE APLICA EN LA QUERY PRINCIPAL (antes de paginación)

  // 9️⃣ Paginación - Count total
  let count = 0;
  try {
    let countQuery = db
      .select({ count: sql<number>`COUNT(DISTINCT ${creditos.credito_id})` }) // 🔥 DISTINCT
      .from(creditos)
      .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .innerJoin(asesores, eq(creditos.asesor_id, asesores.asesor_id))
      .leftJoin(
        platform_users,
        eq(asesores.asesor_id, platform_users.asesor_id)
      )
      .leftJoin(
        moras_credito,
        and(
          eq(creditos.credito_id, moras_credito.credito_id),
          eq(moras_credito.activa, true)
        )
      );

    // 🔥 JOIN con cuotas_credito si filtramos por proximidad
    if (needsProximidadJoin) {
      countQuery = countQuery.innerJoin(
        cuotas_credito,
        eq(creditos.credito_id, cuotas_credito.credito_id)
      ) as any;
    }

    // 🔥 JOIN con creditos_inversionistas si filtramos por inversionistas
    if (inversionista_ids && inversionista_ids.length > 0) {
      countQuery = countQuery.innerJoin(
        creditos_inversionistas,
        eq(creditos.credito_id, creditos_inversionistas.credito_id)
      ) as any;
    }

    const [{ count: total }] = await countQuery.where(whereCondition);

    count = Number(total);
    console.log(`📊 Total créditos únicos: ${count}`);
  } catch (err) {
    console.error("❌ Error contando créditos:", err);
  }

  return {
    data,
    page,
    perPage,
    totalCount: count,
    totalPages: Math.ceil(count / perPage),
  };
}

type Aporte = {
  monto_cash_in: string; // viene como string desde la DB
  monto_inversionista: string;
};

type ResultadoDistribucion = {
  cuota_cash_in: Big;
  iva_cash_in: Big;
  cuota_inversionistas: Big;
  iva_inversionistas: Big;
};

export function calcularDistribucionCuota({
  capital,
  cuota_interes,
  aportes,
}: {
  capital: Big;
  cuota_interes: Big;
  aportes: Aporte[];
}): ResultadoDistribucion {
  const totalCashIn = aportes.reduce(
    (acc, cur) => acc.plus(cur.monto_cash_in),
    new Big(0)
  );

  const totalInversion = aportes.reduce(
    (acc, cur) => acc.plus(cur.monto_inversionista),
    new Big(0)
  );

  const cuota_cash_in = totalCashIn.div(capital).times(cuota_interes).round(2);
  const iva_cash_in = cuota_cash_in.times(0.12).round(2);

  const cuota_inversionistas = totalInversion
    .div(capital)
    .times(cuota_interes)
    .round(2);
  const iva_inversionistas = cuota_inversionistas.times(0.12).round(2);

  return {
    cuota_cash_in,
    iva_cash_in,
    cuota_inversionistas,
    iva_inversionistas,
  };
}

export async function cancelCredit(creditId: number) {
  try {
    // 1. Obtener el crédito
    const [credit] = await db
      .select()
      .from(creditos)
      .where(eq(creditos.credito_id, creditId))
      .limit(1);

    if (!credit) {
      return { message: "Crédito no encontrado." };
    }

    // 2. Mora activa
    const [morasCredito] = await db
      .select()
      .from(moras_credito)
      .where(
        and(
          eq(moras_credito.credito_id, creditId),
          eq(moras_credito.activa, true)
        )
      );

    // 3. Devolver valores unitarios por cuota (fijos del crédito)
    return {
      message: "Resumen del crédito a cancelar",
      credito: {
        capital: credit.capital ?? "0",
        interes: credit.cuota_interes ?? "0",
        iva: credit.iva_12 ?? "0",
        membresias: credit.membresias ?? "0",
        seguro: credit.seguro_10_cuotas ?? "0",
        gps: credit.gps ?? "0",
        mora: morasCredito ? morasCredito.monto_mora : "0",
      },
    };
  } catch (error) {
    console.error("Error cancelando crédito:", error);
    return { message: "Error cancelando crédito", error: String(error) };
  }
}

const MontoAdicionalSchema = z.object({
  concepto: z.string().min(1),
  monto: z.number(), // positivo suma / negativo descuenta
});
// Define the inferred type from the schema
type MontoAdicional = z.infer<typeof MontoAdicionalSchema>;

const AccionCreditoParamsSchema = z.object({
  creditId: z.number(),
  motivo: z.string().optional(),
  observaciones: z.string().optional(),
  monto_cancelacion: z.number().optional(),
  accion: z.enum([
    "CANCELAR",
    "ACTIVAR",
    "INCOBRABLE",
    "PENDIENTE_CANCELACION",
    "EN_CONVENIO",
    "MOROSO",
  ]),
  montosAdicionales: z.array(MontoAdicionalSchema).optional(),
  traspaso: z.number().optional(),
  garantia_mobiliaria: z.number().optional(),
  otros: z.number().optional(),
  cuotas_atrasadas: z.number().int().min(0).optional(),
});

const STATUS_MAP = {
  CANCELAR: "CANCELADO",
  PENDIENTE_CANCELACION: "PENDIENTE_CANCELACION",
  ACTIVAR: "ACTIVO",
  INCOBRABLE: "INCOBRABLE",
  EN_CONVENIO: "EN_CONVENIO",
  MOROSO: "MOROSO",
  // Puedes agregar más acciones aquí si las necesitas
};

/**
 * Actualiza el estado de un crédito: cancela o activa según el parámetro 'accion'.
 */
export type AccionCreditoParams = z.infer<typeof AccionCreditoParamsSchema>;

export async function actualizarEstadoCredito(input: AccionCreditoParams) {
  // Validate input
  const {
    creditId,
    motivo,
    observaciones,
    monto_cancelacion,
    accion,
    montosAdicionales,
    traspaso,
    garantia_mobiliaria,
    otros,
    cuotas_atrasadas,
  } = AccionCreditoParamsSchema.parse(input);

  // Guard rails for actions that require motivo + monto
  const needsReasonAndAmount =
    accion === "CANCELAR" ||
    accion === "PENDIENTE_CANCELACION" ||
    accion === "INCOBRABLE";
  if (needsReasonAndAmount && (!motivo || monto_cancelacion == null)) {
    return {
      ok: false,
      message: "Debes enviar 'motivo' y 'monto_cancelacion' para esta acción.",
    };
  }

  try {
    const result = await db.transaction(async (tx) => {
      /** 1) OPCIONAL: insertar montos adicionales ANTES del cambio de estado */
      if (montosAdicionales?.length) {
        await tx.insert(montos_adicionales).values(
          montosAdicionales.map((m) => ({
            credit_id: creditId,
            concepto: m.concepto,
            monto: m.monto.toString(), // numeric -> string
          }))
        );
      }

      /** 2) Cambios según acción */
      if (accion === "CANCELAR" || accion === "PENDIENTE_CANCELACION") {
        const newStatus =
          STATUS_MAP[accion as keyof typeof STATUS_MAP] ||
          "PENDIENTE_CANCELACION";

        // a) Update credit status
        await tx
          .update(creditos)
          .set({
            statusCredit: newStatus as
              | "CANCELADO"
              | "ACTIVO"
              | "INCOBRABLE"
              | "PENDIENTE_CANCELACION",
          })
          .where(eq(creditos.credito_id, creditId));

        // b) Register cancelation (idempotent insert; assume one row per credit)
        await tx.insert(credit_cancelations).values({
          credit_id: creditId,
          motivo: motivo!, // validated above
          observaciones: observaciones ?? "",
          monto_cancelacion: monto_cancelacion!.toString(),
          traspaso: (traspaso ?? 0).toString(),
          garantia_mobiliaria: (garantia_mobiliaria ?? 0).toString(),
          otros: (otros ?? 0).toString(),
          cuotas_atrasadas: cuotas_atrasadas ?? 0,
        });

        return {
          ok: true,
          message: `Crédito ${newStatus.toLowerCase().replace("_", " ")} correctamente`,
        };
      }

      if (accion === "ACTIVAR") {
        // a) Set ACTIVE
        await tx
          .update(creditos)
          .set({ statusCredit: "ACTIVO" })
          .where(eq(creditos.credito_id, creditId));

        // b) Remove cancelation & bad debt records
        await tx
          .delete(credit_cancelations)
          .where(eq(credit_cancelations.credit_id, creditId));
        await tx.delete(bad_debts).where(eq(bad_debts.credit_id, creditId));
        await tx
          .delete(montos_adicionales)
          .where(eq(montos_adicionales.credit_id, creditId));

        return {
          ok: true,
          message: "Crédito reactivado y registros de cierre eliminados",
        };
      }

      // accion === "INCOBRABLE"
      // TODO: Distribuir abono a capital en tabla espejo (CANCELACION)
      // try {
      //   await distribuirAbonoCapitalEspejo(creditId, monto_cancelacion!.toString(), "CANCELACION");
      //   console.log("✅ Abono capital (incobrable) distribuido en tabla abonos_capital (espejo)");
      // } catch (err) {
      //   console.error("⚠️ Error al distribuir abono en espejo (incobrable):", err);
      // }

      // a) Obtener crédito actual
      const [creditoActual] = await tx
        .select()
        .from(creditos)
        .where(eq(creditos.credito_id, creditId));

      if (!creditoActual) {
        return { ok: false, message: "Crédito no encontrado" };
      }

      // b) Capital = monto_incobrable, plazo = 1, cuota = capital completo
      const capitalIncobrable = new Big(monto_cancelacion!);

      // c) Anular pagos no pagados (NO se borran: se conservan como histórico marcándolos
      //    paymentFalse=true). Además se ponen los *_restante en 0 para que las queries de
      //    cuotas pendientes/atrasadas que NO filtran paymentFalse no muestren deuda fantasma.
      const pagosNoPagados = await tx
        .update(pagos_credito)
        .set({
          paymentFalse: true,
          capital_restante: "0",
          interes_restante: "0",
          iva_12_restante: "0",
          seguro_restante: "0",
          gps_restante: "0",
          total_restante: "0",
          mora: "0",
        })
        .where(
          and(
            eq(pagos_credito.credito_id, creditId),
            eq(pagos_credito.pagado, false)
          )
        )
        .returning({ pago_id: pagos_credito.pago_id });

      const pagoIds = pagosNoPagados.map(p => p.pago_id);

      if (pagoIds.length > 0) {
        console.log(`🚫 Anulados (paymentFalse) ${pagoIds.length} pagos no pagados del crédito #${creditId}`);
      }

      // d) Las cuotas no pagadas NO se borran: se conservan como histórico. Sus pagos quedaron
      //    anulados arriba, así que no aportan saldo en las vistas activas.

      // Crear cuota correlativa para el saldo incobrable
      const [maxCuotaRowDirect] = await tx
        .select({ max: sql<number>`COALESCE(MAX(${cuotas_credito.numero_cuota}), 0)` })
        .from(cuotas_credito)
        .where(eq(cuotas_credito.credito_id, creditId));
      const nextNumeroCuotaIncobrable = Number(maxCuotaRowDirect?.max ?? 0) + 1;

      const [cuotaIncobrableInsertada] = await tx
        .insert(cuotas_credito)
        .values({
          credito_id: creditId,
          numero_cuota: nextNumeroCuotaIncobrable,
          fecha_vencimiento: new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" }),
          pagado: false,
          liquidado_inversionistas: false,
        })
        .returning({ cuota_id: cuotas_credito.cuota_id });

      // e) Actualizar crédito: INCOBRABLE, plazo 1, cuota = capital completo
      await setCapitalSource(tx, "CASTIGO");
      await tx
        .update(creditos)
        .set({
          statusCredit: "INCOBRABLE",
          capital: capitalIncobrable.toString(),
          plazo: 1,
          cuota_interes: "0",
          iva_12: "0",
          membresias_pago: "0",
          membresias: "0",
          seguro_10_cuotas: "0",
          gps: "0",
          royalti: "0",
          porcentaje_royalti: "0",
          otros: "0",
          cuota: capitalIncobrable.toString(),
          deudatotal: capitalIncobrable.toString(),
        })
        .where(eq(creditos.credito_id, creditId));

      // f) Crear pago base con capital_restante = capital, enlazado a la cuota recién creada
      await tx.insert(pagos_credito).values({
        credito_id: creditId,
        cuota: capitalIncobrable.toString(),
        cuota_interes: "0",
        cuota_id: cuotaIncobrableInsertada.cuota_id,
        abono_capital: "0",
        abono_interes: "0",
        abono_iva_12: "0",
        abono_interes_ci: "0",
        abono_iva_ci: "0",
        abono_seguro: "0",
        abono_gps: "0",
        pago_del_mes: "0",
        monto_boleta: "0",
        capital_restante: capitalIncobrable.toString(),
        interes_restante: "0",
        iva_12_restante: "0",
        seguro_restante: "0",
        gps_restante: "0",
        total_restante: capitalIncobrable.toString(),
        membresias: "0",
        membresias_pago: "0",
        membresias_mes: "0",
        mora: "0",
        monto_boleta_cuota: "0",
        seguro_total: "0",
        pagado: false,
        registerBy: "SISTEMA-INCOBRABLE",
        pagoConvenio: "0",
        monto_aplicado: "0",
        observaciones: `Pago base - Crédito marcado como incobrable: ${motivo}`,
      });

      // h) Register bad debt
      await tx.insert(bad_debts).values({
        credit_id: creditId,
        motivo: motivo!,
        observaciones: observaciones ?? "",
        monto_incobrable: monto_cancelacion!.toString(),
      });

      return {
        ok: true,
        message: `Crédito #${creditId} marcado como incobrable. Capital: Q${capitalIncobrable.toString()}, Plazo: 1, Cuota: Q${capitalIncobrable.toString()}, ${pagoIds.length} pagos anulados.`,
      };
    });

    return result;
  } catch (err) {
    console.error("[ERROR] actualizarEstadoCredito:", err);
    return {
      ok: false,
      message: "[ERROR] No fue posible actualizar el estado del crédito",
    };
  }
}
/**
 * Obtiene todos los créditos marcados como incobrables, junto con su usuario e información relevante.
 * Permite paginación para evitar respuestas demasiado grandes.
 * Si se pasa el número de crédito SIFCO, filtra solo ese crédito.
 * @param page Página (empieza en 1)
 * @param perPage Registros por página (default 20)
 * @param numero_credito_sifco (opcional) Número de crédito SIFCO para filtrar
 */
export async function getCreditosIncobrables(
  page: number = 1,
  perPage: number = 20,
  numero_credito_sifco?: string
) {
  try {
    console.log(
      "[getCreditosIncobrables] Iniciando consulta de créditos incobrables..."
    );
    const offset = (page - 1) * perPage;

    // Condición de filtro opcional por número de crédito SIFCO
    const whereCondition =
      numero_credito_sifco && numero_credito_sifco.length > 0
        ? and(
            eq(creditos.statusCredit, "INCOBRABLE"),
            eq(creditos.numero_credito_sifco, numero_credito_sifco)
          )
        : eq(creditos.statusCredit, "INCOBRABLE");

    // Buscar créditos incobrables paginados
    const creditosIncobrables = await db
      .select({
        creditos,
        usuarios,
        asesores,
        bad_debt: bad_debts,
      })
      .from(creditos)
      .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .innerJoin(asesores, eq(creditos.asesor_id, asesores.asesor_id))
      .innerJoin(bad_debts, eq(creditos.credito_id, bad_debts.credit_id))
      .where(eq(creditos.statusCredit, "INCOBRABLE"))
      .orderBy(desc(creditos.fecha_creacion))
      .limit(perPage)
      .offset(offset);

    // Total para paginación
    const [{ count }] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(creditos)
      .where(eq(creditos.statusCredit, "INCOBRABLE"));

    console.log(
      `[getCreditosIncobrables] Créditos incobrables encontrados: ${creditosIncobrables.length}`
    );
    return {
      ok: true,
      data: creditosIncobrables,
      page,
      perPage,
      totalCount: Number(count),
      totalPages: Math.ceil(Number(count) / perPage),
    };
  } catch (error) {
    console.error(
      "[getCreditosIncobrables] Error al obtener créditos incobrables:",
      error
    );
    return {
      ok: false,
      message: "Error al obtener créditos incobrables",
      error: String(error),
    };
  }
}

export async function reiniciarCredito(
  creditId: number,
  montoIncobrable?: number
) {
  await withCapitalContext(null, "REINICIO", null, (tx) =>
    tx
      .update(creditos)
      .set({
        capital: "0",
        deudatotal: montoIncobrable !== undefined ? String(montoIncobrable) : "0",
        cuota_interes: "0",
        cuota: "0",
        iva_12: "0",
        seguro_10_cuotas: "0",
        gps: "0",
        membresias_pago: "0",
        membresias: "0",
        porcentaje_royalti: "0",
        royalti: "0",
        otros: "0",
        statusCredit: "ACTIVO",
      })
      .where(eq(creditos.credito_id, creditId))
  );
}

function construirUrlBoletas(url_boletas: string[], r2BaseUrl: string) {
  return url_boletas.map((url_boleta) => `${r2BaseUrl}${url_boleta}`);
}
export async function resetCredit({
  creditId,
  montoIncobrable,
  montoBoleta,
  url_boletas,
  cuota,
  banco_id,
  numeroAutorizacion,
}: {
  creditId: number;
  montoIncobrable?: number;
  montoBoleta: number | string;
  url_boletas: string[];
  cuota: number;
  banco_id: number;
  numeroAutorizacion?: string;
}) {
  try {
    // 1. Jalar mora activa (si existe, se incluye en el pago de cierre)
    const [moraActiva] = await db
      .select({ monto_mora: moras_credito.monto_mora })
      .from(moras_credito)
      .where(
        and(
          eq(moras_credito.credito_id, creditId),
          eq(moras_credito.activa, true)
        )
      )
      .limit(1);

    const moraBig = new Big(moraActiva?.monto_mora as unknown as string ?? "0");

    // 2. Consultar crédito ANTES de resetearlo (necesitamos los valores originales)
    const [credito] = await db
      .select()
      .from(creditos)
      .where(eq(creditos.credito_id, creditId));
    if (!credito) {
      throw new Error("Crédito no encontrado.");
    }

    // 3. Determinar el estado del crédito
    const statusCredit =
      typeof montoIncobrable !== "undefined" &&
      montoIncobrable > 0 &&
      montoBoleta !== undefined
        ? "INCOBRABLE"
        : "CANCELADO";

    // 4. Jalar la cancelación para obtener cuotas_atrasadas, garantía, traspaso, otros
    const [cancelacion] = await db
      .select()
      .from(credit_cancelations)
      .where(eq(credit_cancelations.credit_id, creditId))
      .limit(1);

    const n = cancelacion?.cuotas_atrasadas ?? 0;

    // 5. Jalar extras (montos_adicionales)
    const extrasRows = await db
      .select({ monto: montos_adicionales.monto })
      .from(montos_adicionales)
      .where(eq(montos_adicionales.credit_id, creditId));

    const totalExtras = extrasRows.reduce(
      (acc, row) => acc.plus(row.monto as unknown as string),
      new Big(0)
    );

    // 6. Calcular abonos reales
    const capitalOriginal = new Big(credito.capital ?? "0");
    const abonoCapital = statusCredit === "INCOBRABLE"
      ? capitalOriginal.minus(new Big(montoIncobrable!))
      : capitalOriginal;
    const abonoInteres = new Big(credito.cuota_interes ?? "0").times(n);
    const abonoIva = new Big(credito.iva_12 ?? "0").times(n);
    const abonoSeguro = new Big(credito.seguro_10_cuotas ?? "0").times(n);
    const abonoGps = new Big(credito.gps ?? "0").times(n);
    const abonoMembresias = new Big(credito.membresias ?? "0").times(n);

    const otrosCancelacion = new Big(cancelacion?.garantia_mobiliaria ?? "0")
      .plus(cancelacion?.traspaso ?? "0")
      .plus(cancelacion?.otros ?? "0")
      .plus(totalExtras);

    const totalMontoPago = abonoCapital
      .plus(abonoInteres)
      .plus(abonoIva)
      .plus(abonoSeguro)
      .plus(abonoGps)
      .plus(abonoMembresias)
      .plus(otrosCancelacion)
      .plus(moraBig);

    // 7. Construir URLs de boletas
    const r2BaseUrl = import.meta.env.URL_PUBLIC_R2 ?? "";
    const urlCompletas = construirUrlBoletas(url_boletas, r2BaseUrl);

    // 8. Obtener pagos del mes + monto de boleta
    const pago_del_mes = await getPagosDelMesActual(credito.credito_id);
    const pago_del_mesBig = new Big(pago_del_mes ?? 0).add(montoBoleta ?? 0);

    // 9. Buscar cuota_id correspondiente
    const [cuotaEncontrada] = await db
      .select({ cuota_id: cuotas_credito.cuota_id })
      .from(cuotas_credito)
      .where(
        and(
          eq(cuotas_credito.credito_id, credito.credito_id),
          eq(cuotas_credito.numero_cuota, cuota)
        )
      )
      .limit(1);

    const cuotaId = cuotaEncontrada?.cuota_id;

    // 10. Insertar pago de cierre con abonos reales
    const [nuevoPago] = await db
      .insert(pagos_credito)
      .values({
        credito_id: credito.credito_id,
        cuota_id: cuotaId,
        cuota: credito.cuota?.toString() ?? "0",
        cuota_interes: credito.cuota_interes?.toString() ?? "0",
        abono_capital: abonoCapital.toString(),
        abono_interes: abonoInteres.toString(),
        abono_iva_12: abonoIva.toString(),
        abono_interes_ci: "0",
        abono_iva_ci: "0",
        abono_seguro: abonoSeguro.toString(),
        abono_gps: abonoGps.toString(),
        pago_del_mes: pago_del_mesBig.toString(),
        monto_boleta: montoBoleta.toString(),
        capital_restante: "0",
        interes_restante: "0",
        iva_12_restante: "0",
        seguro_restante: "0",
        gps_restante: "0",
        total_restante: "0",
        llamada: "",
        renuevo_o_nuevo: "renuevo",
        membresias: "0",
        membresias_pago: abonoMembresias.toString(),
        membresias_mes: abonoMembresias.toString(),
        otros: otrosCancelacion.toString(),
        mora: moraBig.toString(),
        monto_boleta_cuota: montoBoleta.toString(),
        seguro_total: credito.seguro_10_cuotas?.toString() ?? "0",
        pagado: true,
        facturacion: "si",
        mes_pagado: "",
        seguro_facturado: abonoSeguro.toString(),
        gps_facturado: abonoGps.toString(),
        reserva: "0",
        observaciones: "",
        validationStatus: "reset" as const,
        banco_id: banco_id,
        numeroAutorizacion: numeroAutorizacion ?? "",
        registerBy: "system_reset",
        pagoConvenio: "0",
        monto_aplicado: totalMontoPago.toString(),
      })
      .returning();

    // 11. Anular pagos no pagados (NO se borran: se conservan como histórico marcándolos
    //     paymentFalse=true). Además se ponen los *_restante en 0: algunas queries de
    //     cuotas pendientes/atrasadas (getCreditoByNumero, reportes) NO filtran paymentFalse,
    //     así que sin esto mostrarían "deuda fantasma" con los restantes viejos.
    await db
      .update(pagos_credito)
      .set({
        paymentFalse: true,
        capital_restante: "0",
        interes_restante: "0",
        iva_12_restante: "0",
        seguro_restante: "0",
        gps_restante: "0",
        total_restante: "0",
        mora: "0",
      })
      .where(
        and(
          eq(pagos_credito.credito_id, credito.credito_id),
          eq(pagos_credito.pagado, false)
        )
      );

    // 12.1 Crear cuota correlativa (MAX(numero_cuota) + 1) para enlazar el pago de cierre
    const [maxCuotaRow] = await db
      .select({ max: sql<number>`COALESCE(MAX(${cuotas_credito.numero_cuota}), 0)` })
      .from(cuotas_credito)
      .where(eq(cuotas_credito.credito_id, credito.credito_id));
    const nextNumeroCuotaCierre = Number(maxCuotaRow?.max ?? 0) + 1;

    const [cuotaCierre] = await db
      .insert(cuotas_credito)
      .values({
        credito_id: credito.credito_id,
        numero_cuota: nextNumeroCuotaCierre,
        fecha_vencimiento: new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" }),
        liquidado_inversionistas: false,
        pagado: true,
      })
      .returning();

    // 12.2 Enlazar el pago de cierre a la cuota recién creada (cuota correlativa "pagada"),
    // para que el cierre quede asociado a una cuota limpia y no a una cuota vigente del plan.
    if (nuevoPago?.pago_id && cuotaCierre?.cuota_id) {
      await db
        .update(pagos_credito)
        .set({ cuota_id: cuotaCierre.cuota_id })
        .where(eq(pagos_credito.pago_id, nuevoPago.pago_id));
    }

    // 12. Las cuotas no pagadas NO se borran: se conservan como histórico. Sus pagos quedaron
    //     anulados (paymentFalse=true) en el paso 11, así que no aportan saldo en las vistas activas.

    // 12.5 Distribuir abono a capital en tabla espejo (CANCELACION)
    try {
      await distribuirAbonoCapitalEspejo(credito.credito_id, abonoCapital.toString(), "CANCELACION");
      console.log("✅ Abono capital (reset) distribuido en tabla abonos_capital (espejo)");
    } catch (err) {
      console.error("⚠️ Error al distribuir abono en espejo (reset):", err);
    }

    // 13. Distribuir pago entre inversionistas (ANTES de reiniciar, necesita monto_aportado).
    //     Si la suma de aportes es 0 (p.ej. crédito ya reseteado antes) la distribución lanza
    //     excepción; la atrapamos para no abortar el cierre del crédito.
    if (nuevoPago?.pago_id) {
      try {
        await insertPagosCreditoInversionistasV2(
          nuevoPago.pago_id,
          credito.credito_id
        );
      } catch (err) {
        // Solo silenciamos el caso conocido y benigno: crédito SIN aportes (suma = 0),
        // típico de un crédito ya reseteado antes. Cualquier otro fallo (inversionistas o
        // pagos faltantes, error de DB, distribución a medias) SÍ se re-lanza: dejar el
        // cierre sin liquidación de inversionistas e irreintentable sería peor.
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes("suma de montos aportados es 0")) {
          console.warn(
            `⚠️ Distribución a inversionistas omitida (crédito ${credito.credito_id} sin aportes).`
          );
        } else {
          throw err;
        }
      }
    }

    // 14. Reiniciar creditos_inversionistas (no espejo)
    await db
      .update(creditos_inversionistas)
      .set({
        monto_aportado: "0",
        monto_inversionista: "0",
        monto_cash_in: "0",
        iva_inversionista: "0",
        iva_cash_in: "0",
      })
      .where(eq(creditos_inversionistas.credito_id, credito.credito_id));

    // 15. Insertar boletas si existen
    if (
      urlCompletas &&
      urlCompletas.length > 0 &&
      nuevoPago &&
      nuevoPago?.pago_id
    ) {
      await db.insert(boletas).values(
        urlCompletas.map((url) => ({
          pago_id: nuevoPago?.pago_id,
          url_boleta: url,
        }))
      );
    }

    // 16. Al final: zerear el crédito y ponerle el status
    const fechaHoyGT = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });

    if (statusCredit === "INCOBRABLE") {
      const capitalIncobrable = new Big(montoIncobrable!);

      // 16a. Actualizar crédito: capital = incobrable, lo demás en 0 (preservamos porcentaje_interes)
      await withCapitalContext(null, "CASTIGO", null, (tx) =>
        tx
          .update(creditos)
          .set({
            capital: capitalIncobrable.toString(),
            deudatotal: capitalIncobrable.toString(),
            cuota_interes: "0",
            cuota: capitalIncobrable.toString(),
            iva_12: "0",
            seguro_10_cuotas: "0",
            gps: "0",
            membresias_pago: "0",
            membresias: "0",
            porcentaje_royalti: "0",
            royalti: "0",
            otros: "0",
            plazo: 1,
            statusCredit: "INCOBRABLE",
          })
          .where(eq(creditos.credito_id, creditId))
      );

      // 16b. Crear cuota pendiente para el monto incobrable (correlativa)
      const [maxCuotaRowInc] = await db
        .select({ max: sql<number>`COALESCE(MAX(${cuotas_credito.numero_cuota}), 0)` })
        .from(cuotas_credito)
        .where(eq(cuotas_credito.credito_id, credito.credito_id));
      const nextNumeroCuotaPendiente = Number(maxCuotaRowInc?.max ?? 0) + 1;

      const [cuotaPendiente] = await db
        .insert(cuotas_credito)
        .values({
          credito_id: credito.credito_id,
          numero_cuota: nextNumeroCuotaPendiente,
          fecha_vencimiento: fechaHoyGT,
          pagado: false,
          liquidado_inversionistas: false,
        })
        .returning();

      // 16c. Crear pago placeholder (no pagado) con capital_restante = incobrable
      await db.insert(pagos_credito).values({
        credito_id: credito.credito_id,
        cuota_id: cuotaPendiente.cuota_id,
        cuota: capitalIncobrable.toString(),
        cuota_interes: "0",
        abono_capital: "0",
        abono_interes: "0",
        abono_iva_12: "0",
        abono_interes_ci: "0",
        abono_iva_ci: "0",
        abono_seguro: "0",
        abono_gps: "0",
        pago_del_mes: "0",
        monto_boleta: "0",
        capital_restante: capitalIncobrable.toString(),
        interes_restante: "0",
        iva_12_restante: "0",
        seguro_restante: "0",
        gps_restante: "0",
        total_restante: capitalIncobrable.toString(),
        membresias: "0",
        membresias_pago: "0",
        membresias_mes: "0",
        mora: "0",
        monto_boleta_cuota: "0",
        seguro_total: "0",
        pagado: false,
        registerBy: "SISTEMA-INCOBRABLE",
        pagoConvenio: "0",
        monto_aplicado: "0",
        observaciones: `Pago base - Crédito marcado como incobrable (reset)`,
      });

      // 16d. Registrar en bad_debts
      await db.insert(bad_debts).values({
        credit_id: creditId,
        motivo: cancelacion?.motivo ?? "Incobrable",
        observaciones: cancelacion?.observaciones ?? "",
        monto_incobrable: capitalIncobrable.toString(),
      });
    } else {
      // CANCELADO: zerear todo (preservamos porcentaje_interes)
      await withCapitalContext(null, "CANCELACION", null, (tx) =>
        tx
          .update(creditos)
          .set({
            capital: "0",
            deudatotal: "0",
            cuota_interes: "0",
            cuota: "0",
            iva_12: "0",
            seguro_10_cuotas: "0",
            gps: "0",
            membresias_pago: "0",
            membresias: "0",
            porcentaje_royalti: "0",
            royalti: "0",
            otros: "0",
            statusCredit: "CANCELADO",
          })
          .where(eq(creditos.credito_id, creditId))
      );
    }

    // 17. Retorno OK
    return {
      ok: true,
      message: statusCredit === "INCOBRABLE"
        ? `Crédito reiniciado como incobrable. Deuda pendiente: ${montoIncobrable}`
        : "Crédito reiniciado y pago creado exitosamente.",
    };
  } catch (error) {
    console.error("[ERROR] resetCredit:", error);
    throw new Error(
      error instanceof Error
        ? error.message
        : "Error al reiniciar el crédito y crear el pago."
    );
  }
}

type SyncTermsInput = {
  creditoId: number;
  newCuota: number; // incoming updated cuota
  newPlazo: number; // incoming updated plazo (months)
  // Optional: pass preloaded credit to save a roundtrip (if you already fetched it)
  preloadCredit?: {
    cuota: string | number;
    plazo: number;
    capital: string | number;
    porcentaje_interes: string | number;
    iva_12: string | number;
    deudatotal: string | number;
    seguro_10_cuotas: string | number;
    gps: string | number;
    membresias_pago: string | number;
    formato_credito?: string | null;
  };
};

export async function syncScheduleOnTermsChange({
  creditoId,
  newCuota,
  newPlazo,
  preloadCredit,
}: SyncTermsInput) {
  return await db.transaction(async (tx) => {
    // 1) Load current credit
    const [credit] = preloadCredit
      ? [{ credito_id: creditoId, ...preloadCredit }]
      : await tx
          .select({
            credito_id: creditos.credito_id,
            cuota: creditos.cuota,
            plazo: creditos.plazo,
            capital: creditos.capital,
            porcentaje_interes: creditos.porcentaje_interes,
            iva_12: creditos.iva_12,
            deudatotal: creditos.deudatotal,
            seguro_10_cuotas: creditos.seguro_10_cuotas,
            gps: creditos.gps,
            membresias_pago: creditos.membresias_pago,
            formato_credito: creditos.formato_credito,
          })
          .from(creditos)
          .where(eq(creditos.credito_id, creditoId));

    if (!credit) {
      throw new Error("[ERROR] Credit not found");
    }

    const oldCuotaNum = Number(credit.cuota ?? 0);
    const oldPlazoNum = Number(credit.plazo ?? 0);
    const changedCuota = Number(newCuota) !== oldCuotaNum;
    const changedPlazo = Number(newPlazo) !== oldPlazoNum;

    if (!changedCuota && !changedPlazo) {
      // Nothing to do
      return { updated: false, reason: "No changes" };
    }

    // --- helper: generate due dates like your creation logic (30th or last day) ---
    function generateNextDates(fromDateISO: string, count: number): string[] {
      // fromDateISO = 'YYYY-MM-DD'
      const [y, m, d] = fromDateISO.split("-").map((v) => Number(v));
      const base = new Date(Date.UTC(y, m - 1, d, 12, 0, 0)); // noon UTC
      const dates: string[] = [];

      for (let i = 0; i < count; i++) {
        const dt = new Date(base);
        // move month + i + 1 (next months)
        dt.setUTCMonth(dt.getUTCMonth() + i + 1);

        const month = dt.getUTCMonth();
        const year = dt.getUTCFullYear();
        // last day of month
        const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
        const day = lastDay < 30 ? lastDay : 30;

        const final = new Date(Date.UTC(year, month, day, 12, 0, 0));
        // Return in 'sv-SE' like your logic (YYYY-MM-DD)
        const iso = final
          .toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" })
          .toString();
        dates.push(iso);
      }
      return dates;
    }

    // --- 2) If only cuota changed: update cuota in UNPAID payments ---
    if (changedCuota && !changedPlazo) {
      await tx
        .update(pagos_credito)
        .set({
          // only cuota changes, everything else stays as-is
          cuota: new Big(newCuota).round(2).toString(),
        })
        .where(
          and(
            eq(pagos_credito.credito_id, creditoId),
            eq(pagos_credito.pagado, false)
          )
        );

      // Reflect new cuota in creditos row (keeping your other totals untouched)
      await tx
        .update(creditos)
        .set({ cuota: new Big(newCuota).round(2).toString() })
        .where(eq(creditos.credito_id, creditoId));

      return { updated: true, changedCuota: true, changedPlazo: false };
    }

    // --- 3) If plazo changed: add/remove schedule, and also handle cuota change if applies ---
    // Load current cuotas (excluding numero_cuota = 0 "cuota inicial")
    const cuotasRows = await tx
      .select({
        cuota_id: cuotas_credito.cuota_id,
        numero_cuota: cuotas_credito.numero_cuota,
        fecha_vencimiento: cuotas_credito.fecha_vencimiento,
        pagado: cuotas_credito.pagado,
      })
      .from(cuotas_credito)
      .where(eq(cuotas_credito.credito_id, creditoId));

    const cuotasReal = cuotasRows.filter((c) => c.numero_cuota > 0);
    const maxNumero = cuotasReal.reduce(
      (acc, r) => Math.max(acc, Number(r.numero_cuota)),
      0
    );

    // Update cuota for unpaid rows if cuota also changed
    if (changedCuota) {
      await tx
        .update(pagos_credito)
        .set({
          cuota: new Big(newCuota).round(2).toString(),
        })
        .where(
          and(
            eq(pagos_credito.credito_id, creditoId),
            eq(pagos_credito.pagado, false)
          )
        );
    }

    if (newPlazo > oldPlazoNum) {
      // --- 3.a) Increase plazo: append missing cuotas & pagos ---
      const toAppend = newPlazo - oldPlazoNum;

      // last scheduled date to continue from:
      const lastCuota = cuotasReal.sort(
        (a, b) => a.numero_cuota - b.numero_cuota
      )[cuotasReal.length - 1];
      const lastDateISO = lastCuota
        ? (lastCuota.fecha_vencimiento as string)
        : // fallback: if for some reason there is no cuota > 0, base from today like insert
          new Date()
            .toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" })
            .toString();

      const newDates = generateNextDates(lastDateISO, toAppend);

      // Insert cuotas_credito batch
      const newCuotasToInsert = newDates.map((fecha, idx) => ({
        credito_id: creditoId,
        numero_cuota: maxNumero + idx + 1,
        fecha_vencimiento: fecha,
        pagado: false,
      }));

      const insertedCuotas = await tx
        .insert(cuotas_credito)
        .values(newCuotasToInsert)
        .returning({
          cuota_id: cuotas_credito.cuota_id,
          numero_cuota: cuotas_credito.numero_cuota,
          fecha_vencimiento: cuotas_credito.fecha_vencimiento,
        });

      // Build pagos for each new cuota, mirroring your creation template
      const cuotaStr = new Big(changedCuota ? newCuota : oldCuotaNum)
        .round(2)
        .toString();

      const pagosToInsert = insertedCuotas.map((c) => {
        // 🔥 Parsear fecha como local, no UTC (evita desfase de timezone)
        const [year, month, day] = c.fecha_vencimiento.slice(0, 10).split("-").map(Number);
        const fechaPagoLocal = new Date(year, month - 1, day);

        return {
        credito_id: creditoId,
        cuota: cuotaStr,
        // keep interest per your credit row (unchanged here)
        cuota_interes: new Big(credit.porcentaje_interes ?? 0)
          .times(new Big(credit.capital ?? 0).div(100))
          .round(2)
          .toString(), // same formula you used on create (capital * rate%)
        cuota_id: c.cuota_id,
        fecha_pago: fechaPagoLocal,
        abono_capital: "0",
        abono_interes: "0",
        abono_iva_12: "0",
        abono_interes_ci: "0",
        abono_iva_ci: "0",
        abono_seguro:
          Number(credit.seguro_10_cuotas ?? 0) > 0 ? "0" : undefined,
        abono_gps: Number(credit.gps ?? 0) > 0 ? "0" : undefined,
        pago_del_mes: "0",
        monto_boleta: "0",
        fecha_vencimiento: c.fecha_vencimiento,
        renuevo_o_nuevo: "",
        capital_restante: new Big(credit.capital ?? 0).toString(),
        interes_restante: new Big(credit.porcentaje_interes ?? 0)
          .times(new Big(credit.capital ?? 0).div(100))
          .round(2)
          .toString(),
        iva_12_restante: new Big(credit.porcentaje_interes ?? 0)
          .times(new Big(credit.capital ?? 0).div(100))
          .times(0.12)
          .round(2)
          .toString(),
        seguro_restante: new Big(credit.seguro_10_cuotas ?? 0).toString(),
        gps_restante: new Big(credit.gps ?? 0).toString(),
        total_restante: new Big(credit.deudatotal ?? 0).toString(),
        membresias: new Big(credit.membresias_pago ?? 0).toString(),
        membresias_pago: "0",
        membresias_mes: "0",
        otros: "",
        mora: "0",
        monto_boleta_cuota: "0",
        seguro_total: new Big(credit.seguro_10_cuotas ?? 0).toString(),
        pagado: false,
        facturacion: "si",
        mes_pagado: "",
        seguro_facturado: new Big(credit.seguro_10_cuotas ?? 0).toString(),
        gps_facturado: new Big(credit.gps ?? 0).toString(),
        reserva: "0",
        observaciones: "",
        paymentFalse: false,
        registerBy: "system_reset",
        pagoConvenio: "0",
        monto_aplicado: "0",
      };
      });

      await tx.insert(pagos_credito).values(pagosToInsert);
    } else if (newPlazo < oldPlazoNum) {
      // --- 3.b) Decrease plazo: remove extra unpaid quotas & their payments ---
      const extra = cuotasReal.filter((c) => Number(c.numero_cuota) > newPlazo);

      // Safety: if any of the "extra" are paid, abort
      const paidExtra = extra.filter((c) => c.pagado);
      if (paidExtra.length > 0) {
        throw new Error(
          "[ERROR] Cannot reduce plazo below a paid cuota. Please reverse or adjust paid cuotas first."
        );
      }

      const extraCuotaIds = extra.map((c) => c.cuota_id);
      if (extraCuotaIds.length > 0) {
        const safeExtraCuotaIds = extraCuotaIds.filter((id): id is number => id !== null);
        if (safeExtraCuotaIds.length > 0) {
          // delete related pagos first
          await tx
            .delete(pagos_credito)
            .where(inArray(pagos_credito.cuota_id, safeExtraCuotaIds));
          // then delete cuotas
          await tx
            .delete(cuotas_credito)
            .where(inArray(cuotas_credito.cuota_id, safeExtraCuotaIds));
        }
      }
    }

    // --- 4) Persist credit row fields actually changed (only cuota/plazo) ---
    const updateSet: Record<string, any> = {};
    if (changedCuota) updateSet.cuota = new Big(newCuota).round(2).toString();
    if (changedPlazo) updateSet.plazo = Number(newPlazo);

    if (Object.keys(updateSet).length > 0) {
      await tx
        .update(creditos)
        .set(updateSet)
        .where(eq(creditos.credito_id, creditoId));
    }

    return { updated: true, changedCuota, changedPlazo };
  });
}
interface MergeCreditParams {
  numero_credito_origen: string; // El crédito que se va a absorber
  numero_credito_destino: string; // El crédito que va a quedar activo
}

interface CreditoCompleto {
  credito_id: number;
  capital: string;
  porcentaje_interes: string;
  cuota: string;
  cuota_interes: string;
  deudatotal: string;
  plazo: number;
  iva_12: string;
  seguro_10_cuotas: string;
  gps: string;
  membresias_pago: string;
  membresias: string;
  otros: string;
  usuario_id: number;
  asesor_id: number;
  numero_credito_sifco: string;
  [key: string]: any;
}

// ========================================
// MÉTODO PRINCIPAL: FUSIONAR CRÉDITOS
// ========================================

export const mergeCreditosAndUpdate = async ({
  numero_credito_origen,
  numero_credito_destino,
}: MergeCreditParams): Promise<{
  success: boolean;
  message: string;
  creditoFinal: any;
  nueva_cuota: number;
}> => {
  console.log("🔄 ========================================");
  console.log("🔄 INICIANDO FUSIÓN DE CRÉDITOS");
  console.log("🔄 ========================================");
  console.log(`📋 Crédito ORIGEN (se absorberá): ${numero_credito_origen}`);
  console.log(`📋 Crédito DESTINO (quedará activo): ${numero_credito_destino}`);
  console.log("");

  try {
    // ========================================
    // PASO 1: OBTENER AMBOS CRÉDITOS
    // ========================================
    console.log("📥 PASO 1: Buscando ambos créditos...");

    const [creditoOrigen] = (await db
      .select()
      .from(creditos)
      .where(eq(creditos.numero_credito_sifco, numero_credito_origen))
      .limit(1)) as CreditoCompleto[];

    const [creditoDestino] = (await db
      .select()
      .from(creditos)
      .where(eq(creditos.numero_credito_sifco, numero_credito_destino))
      .limit(1)) as CreditoCompleto[];

    if (!creditoOrigen) {
      console.log("❌ ERROR: No se encontró el crédito origen");
      throw new Error(`Crédito origen ${numero_credito_origen} no encontrado`);
    }

    if (!creditoDestino) {
      console.log("❌ ERROR: No se encontró el crédito destino");
      throw new Error(
        `Crédito destino ${numero_credito_destino} no encontrado`
      );
    }

    console.log(
      `✅ Crédito ORIGEN encontrado - ID: ${creditoOrigen.credito_id}`
    );
    console.log(`   - Capital: Q${creditoOrigen.capital}`);
    console.log(`   - Cuota: Q${creditoOrigen.cuota}`);
    console.log(`   - Seguro: Q${creditoOrigen.seguro_10_cuotas}`);
    console.log(`   - GPS: Q${creditoOrigen.gps}`);
    console.log(`   - Membresías: Q${creditoOrigen.membresias_pago}`);
    console.log(`   - Otros: Q${creditoOrigen.otros}`);

    console.log(
      `✅ Crédito DESTINO encontrado - ID: ${creditoDestino.credito_id}`
    );
    console.log(`   - Capital: Q${creditoDestino.capital}`);
    console.log(`   - Cuota: Q${creditoDestino.cuota}`);
    console.log(`   - Seguro: Q${creditoDestino.seguro_10_cuotas}`);
    console.log(`   - GPS: Q${creditoDestino.gps}`);
    console.log(`   - Membresías: Q${creditoDestino.membresias_pago}`);
    console.log(`   - Otros: Q${creditoDestino.otros}`);
    console.log("");

    // ========================================
    // PASO 2: SUMAR VALORES Y RECALCULAR
    // ========================================
    console.log("🧮 PASO 2: Sumando capitales y recalculando todo...");

    // Sumar capitales
    const capitalOrigen = new Big(creditoOrigen.capital);
    const capitalDestino = new Big(creditoDestino.capital);
    const capitalTotal = capitalOrigen.plus(capitalDestino);

    console.log(`   📊 Capital ORIGEN: Q${capitalOrigen.toString()}`);
    console.log(`   📊 Capital DESTINO: Q${capitalDestino.toString()}`);
    console.log(`   ➕ CAPITAL TOTAL: Q${capitalTotal.toString()}`);

    // Usar el porcentaje de interés del crédito destino
    const porcentaje_interes = new Big(creditoDestino.porcentaje_interes);
    console.log(`   📈 Porcentaje interés: ${porcentaje_interes.toString()}%`);

    // Calcular cuota_interes con el nuevo capital
    const cuota_interes = capitalTotal
      .times(porcentaje_interes.div(100))
      .round(2);
    console.log(
      `   💵 Cuota interés (recalculada): Q${cuota_interes.toString()}`
    );

    // Calcular IVA 12%
    const iva_12 = cuota_interes.times(0.12).round(2);
    console.log(`   🧾 IVA 12%: Q${iva_12.toString()}`);

    // Sumar seguros, GPS, membresías, otros
    const seguro_total = new Big(creditoOrigen.seguro_10_cuotas || "0").plus(
      new Big(creditoDestino.seguro_10_cuotas || "0")
    );

    const gps_total = new Big(creditoOrigen.gps || "0").plus(
      new Big(creditoDestino.gps || "0")
    );

    const membresias_total = new Big(creditoOrigen.membresias_pago || "0").plus(
      new Big(creditoDestino.membresias_pago || "0")
    );

    const otros_total = new Big(creditoOrigen.otros || "0").plus(
      new Big(creditoDestino.otros || "0")
    );

    console.log(`   🛡️  Seguro total: Q${seguro_total.toString()}`);
    console.log(`   📡 GPS total: Q${gps_total.toString()}`);
    console.log(`   💳 Membresías total: Q${membresias_total.toString()}`);
    console.log(`   📝 Otros total: Q${otros_total.toString()}`);

    // Sumar cuotas
    const cuota_origen = new Big(creditoOrigen.cuota);
    const cuota_destino = new Big(creditoDestino.cuota);
    const cuota_total = cuota_origen.plus(cuota_destino).round(2);

    console.log(`   💰 Cuota ORIGEN: Q${cuota_origen.toString()}`);
    console.log(`   💰 Cuota DESTINO: Q${cuota_destino.toString()}`);
    console.log(`   ➕ CUOTA TOTAL: Q${cuota_total.toString()}`);

    // Calcular deuda total
    const deudatotal = capitalTotal
      .plus(cuota_interes)
      .plus(iva_12)
      .plus(seguro_total)
      .plus(gps_total)
      .plus(membresias_total)
      .plus(otros_total)
      .round(2);

    console.log(`   💵💵 DEUDA TOTAL (recalculada): Q${deudatotal.toString()}`);
    console.log("");

    // ========================================
    // PASO 3: ACTUALIZAR CRÉDITO DESTINO
    // ========================================
    console.log(
      "💾 PASO 3: Actualizando crédito destino con valores consolidados..."
    );

    const [creditoActualizado] = await withCapitalContext(null, "MERGE", null, (tx) =>
      tx
        .update(creditos)
        .set({
          capital: capitalTotal.toString(),
          cuota: cuota_total.toString(),
          cuota_interes: cuota_interes.toString(),
          iva_12: iva_12.toString(),
          deudatotal: deudatotal.toString(),
          seguro_10_cuotas: seguro_total.toString(),
          gps: gps_total.toString(),
          membresias_pago: membresias_total.toString(),
          membresias: membresias_total.toString(),
          otros: otros_total.toString(),
        })
        .where(eq(creditos.credito_id, creditoDestino.credito_id))
        .returning()
    );

    console.log(
      `   ✅ Crédito ${creditoDestino.numero_credito_sifco} actualizado exitosamente`
    );
    console.log(`   📊 Nuevo capital: Q${capitalTotal.toString()}`);
    console.log(`   💰 Nueva cuota: Q${cuota_total.toString()}`);
    console.log(`   💵 Nueva deuda total: Q${deudatotal.toString()}`);
    console.log("");

    // ========================================
    // PASO 4: TRASLADAR INVERSIONISTAS DEL ORIGEN AL DESTINO
    // ========================================
    console.log(
      "👥 PASO 4: Trasladando inversionistas del crédito ORIGEN al DESTINO..."
    );

    const inversionistasOrigen = await db
      .select()
      .from(creditos_inversionistas)
      .where(eq(creditos_inversionistas.credito_id, creditoOrigen.credito_id));

    if (inversionistasOrigen.length > 0) {
      console.log(
        `   📋 Se encontraron ${inversionistasOrigen.length} inversionistas en el crédito origen`
      );

      // Actualizar el credito_id de todos los inversionistas del origen
      await db
        .update(creditos_inversionistas)
        .set({
          credito_id: creditoDestino.credito_id,
        })
        .where(
          eq(creditos_inversionistas.credito_id, creditoOrigen.credito_id)
        );

      console.log(
        `   ✅ ${inversionistasOrigen.length} inversionistas trasladados al crédito destino`
      );

      inversionistasOrigen.forEach((inv, index) => {
        console.log(
          `      ${index + 1}. Inversionista ID: ${inv.inversionista_id}`
        );
        console.log(`         - Monto aportado: Q${inv.monto_aportado}`);
        console.log(`         - Cuota: Q${inv.cuota_inversionista}`);
      });
    } else {
      console.log(
        `   ℹ️  No hay inversionistas en el crédito origen para trasladar`
      );
    }
    console.log("");

    // ========================================
    // PASO 5: MARCAR CRÉDITO ORIGEN COMO CANCELADO
    // ========================================
    console.log("🔒 PASO 5: Marcando crédito origen como CANCELADO...");

    await db
      .update(creditos)
      .set({
        statusCredit: "CANCELADO",
      })
      .where(eq(creditos.credito_id, creditoOrigen.credito_id));

    console.log(
      `   ✅ Crédito ${creditoOrigen.numero_credito_sifco} (ID: ${creditoOrigen.credito_id}) marcado como CANCELADO`
    );
    console.log("");

    // ========================================
    // PASO 6: LLAMAR A updateInstallments
    // ========================================
    console.log("📅 PASO 6: Recalculando cuotas con updateInstallments...");
    console.log(`   🔄 Llamando updateInstallments con:`);
    console.log(`      - numero_credito_sifco: ${numero_credito_destino}`);
    console.log(`      - nueva_cuota: Q${cuota_total.toNumber()}`);

    await updateInstallments({
      numero_credito_sifco: numero_credito_destino,
      nueva_cuota: cuota_total.toNumber(),
    });

    console.log(`   ✅ Cuotas recalculadas exitosamente`);
    console.log("");

    // ========================================
    // RESULTADO FINAL
    // ========================================
    const inversionistasDestino = await db
      .select()
      .from(creditos_inversionistas)
      .where(eq(creditos_inversionistas.credito_id, creditoDestino.credito_id));

    const totalInversionistas = inversionistasDestino.length;

    console.log("✅ ========================================");
    console.log("✅ FUSIÓN COMPLETADA EXITOSAMENTE");
    console.log("✅ ========================================");
    console.log(
      `📋 Crédito activo: ${numero_credito_destino} (ID: ${creditoDestino.credito_id})`
    );
    console.log(`💰 Capital consolidado: Q${capitalTotal.toString()}`);
    console.log(`💵 Nueva cuota mensual: Q${cuota_total.toString()}`);
    console.log(`💵 Nueva deuda total: Q${deudatotal.toString()}`);
    console.log(`👥 Total inversionistas: ${totalInversionistas}`);
    console.log(
      `🔒 Crédito cancelado: ${numero_credito_origen} (ID: ${creditoOrigen.credito_id})`
    );
    console.log("");

    return {
      success: true,
      message: "Créditos fusionados exitosamente",
      nueva_cuota: cuota_total.toNumber(),
      creditoFinal: {
        numero_credito: numero_credito_destino,
        credito_id: creditoDestino.credito_id,
        capital_total: capitalTotal.toString(),
        cuota: cuota_total.toString(),
        deuda_total: deudatotal.toString(),
        total_inversionistas: totalInversionistas,
        credito_cancelado: numero_credito_origen,
      },
    };
  } catch (error) {
    console.log("❌ ========================================");
    console.log("❌ ERROR EN LA FUSIÓN DE CRÉDITOS");
    console.log("❌ ========================================");
    console.error(error);
    throw error;
  }
};

// ========================================
// MÉTODO PARA ACTUALIZAR CUOTAS (PLACEHOLDER)
// ========================================

interface UpdateInstallmentsParams {
  numero_credito_sifco: string;
  nueva_cuota: number;
}

const updateInstallments = async ({
  numero_credito_sifco,
  nueva_cuota,
}: UpdateInstallmentsParams): Promise<void> => {
  console.log(`   🔄 Ejecutando updateInstallments...`);
  console.log(`   📋 Crédito: ${numero_credito_sifco}`);
  console.log(`   💰 Nueva cuota: Q${nueva_cuota}`);
  // Aquí va tu implementación existente
};

// ========================================
// ESTADÍSTICAS DE CRÉDITOS
// ========================================

interface CreditStats {
  cantidad: number;
  porcentaje: string;
  sumaCapital: string;
  sumaMora: string;
  // Enriquecido desde el catálogo dinámico `cartera.buckets` — permite a
  // consumidores (CRM) resolver el bucket sin mantener su propio mapeo
  // numero↔estadoMora en código.
  estadoMora?: string;
  label?: string;
  color?: string | null;
  prefijo?: string;
}

interface CreditStatsResponse {
  totalCreditos: number;
  efectividad: string; // Porcentaje de créditos SIN cuotas atrasadas
  // Record dinámico: keys = numero del bucket del catálogo ("0".."5" y futuros).
  porCuotasAtrasadas: Record<string, CreditStats>;
  porEstado: {
    cancelado: CreditStats;
    incobrable: CreditStats;
  };
}

export const getCreditStats = async (email?: string): Promise<CreditStatsResponse> => {
  console.log(`📊 Obteniendo estadísticas de créditos...`);
  if (email) {
    console.log(`   🔍 Filtrando por asesor con email: ${email}`);
  }

  // Obtener el asesor_id si se proporciona email
  let asesorId: number | null = null;
  if (email) {
    const platformUser = await db
      .select({ asesor_id: asesores.asesor_id })
      .from(asesores)
      // 🔥 case/espacios-insensible: el email de sesión del CRM puede venir con otro casing
      .where(sql`LOWER(${asesores.emailCashIn}) = ${email.trim().toLowerCase()}`)
      .limit(1);

    if (platformUser.length > 0 && platformUser[0].asesor_id) {
      asesorId = platformUser[0].asesor_id;
      console.log(`   ✅ Asesor encontrado con ID: ${asesorId}`);
    } else {
      console.log(`   ⚠️ No se encontró asesor con email: ${email}`);
    }
  }

  // Primero obtener el total de créditos activos para calcular porcentajes
  const baseConditionsTotal = [
    inArray(creditos.statusCredit, ["ACTIVO", "MOROSO", "EN_CONVENIO"]),
  ];
  if (asesorId) {
    baseConditionsTotal.push(eq(creditos.asesor_id, asesorId));
  }

  const totalResult = await db
    .select({
      total: sql<number>`COUNT(DISTINCT ${creditos.credito_id})::int`,
    })
    .from(creditos)
    .where(and(...baseConditionsTotal));

  const totalCreditosActivos = totalResult[0]?.total || 0;

  // Estadísticas por cuotas atrasadas — buckets definidos en el catálogo
  // dinámico `cartera.buckets` (fuente única). Agregar/mover una etapa se hace
  // ahí (fila en la tabla), sin tocar este loop.
  type StatsBucketDef = {
    key: string;
    min: number;
    max: number | null;
    estadoMora?: string;
    label?: string;
    color?: string | null;
    prefijo?: string;
  };

  // Fallback: catálogo aún no sembrado (migración pendiente) O query falla
  // (columna estado_mora sin aplicar, DB caída) — no tirar 500 en /stats,
  // usar los rangos B0-B5 conocidos por una release.
  let catalogoRows: Awaited<ReturnType<typeof getBucketsCatalogo>> = [];
  try {
    catalogoRows = await getBucketsCatalogo();
  } catch (err) {
    console.error("❌ Error cargando catálogo de buckets (stats):", err);
  }

  const statsBuckets: StatsBucketDef[] =
    catalogoRows.length > 0
      ? catalogoRows.map((b) => ({
          key: String(b.numero),
          min: b.cuotas_min,
          max: b.cuotas_max,
          estadoMora: b.estado_mora ?? undefined,
          label: b.nombre,
          color: b.color,
          prefijo: b.prefijo,
        }))
      : FALLBACK_BUCKETS_CUOTAS.map((b) => ({
          key: String(b.numero),
          min: b.cuotas_min,
          max: b.cuotas_max,
          estadoMora: b.estado_mora,
          label: b.nombre,
          prefijo: b.prefijo,
        }));

  const statsPerCuotasAtrasadas: Record<string, CreditStats> = {};
  for (const b of statsBuckets) {
    statsPerCuotasAtrasadas[b.key] = {
      cantidad: 0,
      porcentaje: "0",
      sumaCapital: "0",
      sumaMora: "0",
      estadoMora: b.estadoMora,
      label: b.label,
      color: b.color,
      prefijo: b.prefijo,
    };
  }

  // Consulta para créditos activos/morosos con sus moras
  const baseConditionsActive = [
    inArray(creditos.statusCredit, ["ACTIVO", "MOROSO", "EN_CONVENIO"]),
  ];

  if (asesorId) {
    baseConditionsActive.push(eq(creditos.asesor_id, asesorId));
  }

  let creditosSinAtraso = 0;

  for (const b of statsBuckets) {
    // Condición SQL derivada del rango del bucket:
    //   max === null  → >= min (el "+")
    //   min === max   → = min (exacto)
    //   min < max     → BETWEEN min AND max
    const cuotasCond =
      b.max === null
        ? sql`COALESCE(${moras_credito.cuotas_atrasadas}, 0) >= ${b.min}`
        : b.min === b.max
          ? sql`COALESCE(${moras_credito.cuotas_atrasadas}, 0) = ${b.min}`
          : sql`COALESCE(${moras_credito.cuotas_atrasadas}, 0) BETWEEN ${b.min} AND ${b.max}`;

    const result = await db
      .select({
        cantidad: sql<number>`COUNT(DISTINCT ${creditos.credito_id})::int`,
        sumaCapital: sql<string>`COALESCE(SUM(${creditos.capital}), 0)::text`,
        sumaMora: sql<string>`COALESCE(SUM(CASE WHEN ${moras_credito.activa} = true THEN ${moras_credito.monto_mora} ELSE 0 END), 0)::text`,
      })
      .from(creditos)
      .leftJoin(
        moras_credito,
        and(
          eq(creditos.credito_id, moras_credito.credito_id),
          eq(moras_credito.activa, true)
        )
      )
      .where(and(...baseConditionsActive, cuotasCond));

    const cantidad = result[0]?.cantidad || 0;
    const porcentaje = totalCreditosActivos > 0
      ? ((cantidad / totalCreditosActivos) * 100).toFixed(2)
      : "0";

    if (b.min === 0 && b.max === 0) {
      creditosSinAtraso = cantidad;
    }

    statsPerCuotasAtrasadas[b.key] = {
      ...statsPerCuotasAtrasadas[b.key],
      cantidad,
      porcentaje,
      sumaCapital: result[0]?.sumaCapital || "0",
      sumaMora: result[0]?.sumaMora || "0",
    };
  }

  // Calcular efectividad: porcentaje de créditos SIN cuotas atrasadas
  const efectividad = totalCreditosActivos > 0 
    ? ((creditosSinAtraso / totalCreditosActivos) * 100).toFixed(2) 
    : "0";

  // Estadísticas por estado (CANCELADO, INCOBRABLE)
  const statsPerEstado = {
    cancelado: { cantidad: 0, porcentaje: "0", sumaCapital: "0", sumaMora: "0" },
    incobrable: { cantidad: 0, porcentaje: "0", sumaCapital: "0", sumaMora: "0" },
  };

  // Obtener total de créditos cancelados + incobrables para sus porcentajes
  const baseConditionsStatusTotal = [
    inArray(creditos.statusCredit, ["CANCELADO", "INCOBRABLE"]),
  ];
  if (asesorId) {
    baseConditionsStatusTotal.push(eq(creditos.asesor_id, asesorId));
  }

  const totalStatusResult = await db
    .select({
      total: sql<number>`COUNT(DISTINCT ${creditos.credito_id})::int`,
    })
    .from(creditos)
    .where(and(...baseConditionsStatusTotal));

  const totalCreditosStatus = totalStatusResult[0]?.total || 0;

  for (const estado of ["CANCELADO", "INCOBRABLE"] as const) {
    const baseConditionsStatus = [eq(creditos.statusCredit, estado)];

    if (asesorId) {
      baseConditionsStatus.push(eq(creditos.asesor_id, asesorId));
    }

    const result = await db
      .select({
        cantidad: sql<number>`COUNT(DISTINCT ${creditos.credito_id})::int`,
        sumaCapital: sql<string>`COALESCE(SUM(${creditos.capital}), 0)::text`,
        sumaMora: sql<string>`COALESCE(SUM(CASE WHEN ${moras_credito.activa} = true THEN ${moras_credito.monto_mora} ELSE 0 END), 0)::text`,
      })
      .from(creditos)
      .leftJoin(
        moras_credito,
        and(
          eq(creditos.credito_id, moras_credito.credito_id),
          eq(moras_credito.activa, true)
        )
      )
      .where(and(...baseConditionsStatus));

    const cantidad = result[0]?.cantidad || 0;
    const porcentaje = totalCreditosStatus > 0 
      ? ((cantidad / totalCreditosStatus) * 100).toFixed(2) 
      : "0";

    const key = estado.toLowerCase() as "cancelado" | "incobrable";
    statsPerEstado[key] = {
      cantidad,
      porcentaje,
      sumaCapital: result[0]?.sumaCapital || "0",
      sumaMora: result[0]?.sumaMora || "0",
    };
  }

  console.log(`📊 Estadísticas obtenidas exitosamente`);

  return {
    totalCreditos: totalCreditosActivos,
    efectividad,
    porCuotasAtrasadas: statsPerCuotasAtrasadas as CreditStatsResponse["porCuotasAtrasadas"],
    porEstado: statsPerEstado,
  };
};

// ============================================
// 🔥 Activar/Desactivar Cancelación de Crédito
// ============================================
export async function toggleCancelacionActivo(params: {
  creditId: number;
  activo: boolean;
}) {
  const { creditId, activo } = params;

  try {
    // 1. Verificar que existe la cancelación
    const [cancelacion] = await db
      .select()
      .from(credit_cancelations)
      .where(eq(credit_cancelations.credit_id, creditId))
      .limit(1);

    if (!cancelacion) {
      return {
        success: false,
        message: "No existe una cancelación para este crédito.",
      };
    }

    // 2. Actualizar el estado
    await db
      .update(credit_cancelations)
      .set({ activo })
      .where(eq(credit_cancelations.credit_id, creditId));

    console.log(`✅ Cancelación de crédito ${creditId} ${activo ? "ACTIVADA" : "DESACTIVADA"}`);

    return {
      success: true,
      message: `Cancelación ${activo ? "activada" : "desactivada"} exitosamente.`,
      data: {
        credit_id: creditId,
        activo,
      },
    };
  } catch (error) {
    console.error("❌ Error actualizando estado de cancelación:", error);
    return {
      success: false,
      message: "Error actualizando estado de cancelación",
      error: String(error),
    };
  }
}

// ============================================
// Actualizar NIT de un crédito (usuario)
// ============================================
export async function actualizarNitCredito({
  numero_credito_sifco,
  nit,
}: {
  numero_credito_sifco: string;
  nit: string;
}) {
  // 1. Buscar el crédito
  const [credito] = await db
    .select({
      credito_id: creditos.credito_id,
      usuario_id: creditos.usuario_id,
    })
    .from(creditos)
    .where(eq(creditos.numero_credito_sifco, numero_credito_sifco))
    .limit(1);

  if (!credito) {
    return { success: false, message: "Crédito no encontrado" };
  }

  // 2. Actualizar el NIT del usuario
  await db
    .update(usuarios)
    .set({ nit })
    .where(eq(usuarios.usuario_id, credito.usuario_id));

  return {
    success: true,
    message: `NIT actualizado a ${nit} para el crédito ${numero_credito_sifco}`,
  };
}
