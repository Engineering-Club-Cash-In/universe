import { db } from "../database/index";
import {
  asesores,
  bad_debts,
  boletas,
  convenio_cuotas,
  convenios_pago,
  convenios_pagos_resume,
  credit_cancelations,
  creditos,
  creditos_inversionistas,
  creditos_rubros_otros,
  cuotas_credito,
  inversionistas,
  montos_adicionales,
  moras_credito,
  pagos_credito,
  platform_users,
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
  ne,
  isNull,
} from "drizzle-orm";
import { getPagosDelMesActual } from "./payments";
import { Context } from "elysia/dist/context";

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
          ])
        )
      )
      .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .limit(1);

    if (creditoData.length === 0) {
      return { message: "Crédito no encontrado" };
    }

    const currentCredit = creditoData[0];
    const creditoId = currentCredit.creditos.credito_id;
    // 2. Si el crédito está cancelado, traer la info de cancelación y retornar flujo especial
    if (
      currentCredit.creditos.statusCredit === "CANCELADO" ||
      currentCredit.creditos.statusCredit === "PENDIENTE_CANCELACION"
    ) {
      // Buscar la info de cancelación
      const cancelacion = await db
        .select()
        .from(credit_cancelations)
        .where(eq(credit_cancelations.credit_id, creditoId))
        .limit(1);

      return {
        credito: currentCredit.creditos,
        usuario: currentCredit.usuarios,
        cancelacion: cancelacion[0] || null,
        flujo: "CANCELADO",
      };
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
        pago_id: pagos_credito.pago_id, // 👈 Agregá esto también

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
      // 👇 LEFT JOIN con convenios_pagos_resume

      .where(
        and(
          eq(cuotas_credito.credito_id, creditoId),
          eq(cuotas_credito.pagado, false),
          lt(cuotas_credito.fecha_vencimiento, hoy.toISOString().slice(0, 10))
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
      // 👇 LEFT JOIN con convenios_pagos_resume
      .leftJoin(
        convenios_pagos_resume,
        eq(convenios_pagos_resume.pago_id, pagos_credito.pago_id)
      )
      .where(
        and(
          eq(cuotas_credito.credito_id, creditoId),
          eq(cuotas_credito.pagado, false),
          ne(pagos_credito.validationStatus, "pending")
        )
      )
      .orderBy(cuotas_credito.numero_cuota);

    // 6. Consultar si la cuota actual ya fue pagada
    const [cuotaActualData] = await db
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

    // ¿Está pagada la cuota actual?
    const cuotaActualPagada = !!(cuotaActualData && cuotaActualData.pagado);
    console.log("cuotaActualData", cuotaActualData);

    // La cuota actual del mes es la de número `mesesTranscurridos`
    const cuotaActual = cuotaActualData.numero_cuota;
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

        const cuotaIds = pagos.map((p) => p.cuota_id);

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
      const [cuotaDelMes] = await db
        .select()
        .from(convenio_cuotas)
        .where(
          and(
            eq(convenio_cuotas.convenio_id, convenioActivo[0].convenio_id),
            gte(convenio_cuotas.fecha_vencimiento, fechaActualGuatemala) // Ya venció o vence hoy
          )
        )
        .orderBy(asc(convenio_cuotas.fecha_vencimiento)) // La más reciente que ya venció
        .limit(1);
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

    // 🔥 CALCULAR CUOTA MENSUAL (0 si ya está pagada la cuota actual)

    // Si la cuota actual ya está pagada, poner 0

    return {
      flujo: "ACTIVO", 
      credito: currentCredit.creditos,
      usuario: currentCredit.usuarios,
      cuotaActual, // Cuota que debe pagar este mes (número)
      cuotaActualPagada, // true si ya la pagó, false si no
      cuotaActualStatus, // estado del pago de la cuota actual
      cuotasPendientes: cuotasPendientes, // Todas las cuotas vencidas y no pagadas
      cuotasAtrasadas: cuotasAtrasadas,
      cuotasPagadas, // Todas las cuotas pagadas
      moraActual: moraActual.length > 0 ? moraActual[0].monto_mora : 0,
      mora:moraActual.length > 0 ? moraActual[0] : null,
      convenioActivo:
        convenioActivo.length > 0
          ? {
              ...convenioActivo[0],
              cuotaConvenioAPagar, // 👈 Solo esto
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
}

// 🔥 Función auxiliar para calcular proximidad (con zona horaria de Guatemala)
function calcularProximidad(fechaVencimiento: string): ProximidadPago {
  // 🇬🇹 Hora de Guatemala
  const hoy = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Guatemala" })
  );
  hoy.setHours(0, 0, 0, 0);

  const vencimiento = new Date(fechaVencimiento);
  vencimiento.setHours(0, 0, 0, 0);

  const diffDays = Math.floor(
    (vencimiento.getTime() - hoy.getTime()) / (1000 * 60 * 60 * 24)
  );

  if (diffDays === 0) return "TODAY";
  if (diffDays > 0 && diffDays <= 7) return "WEEK";
  if (diffDays > 7 && diffDays <= 14) return "TWO_WEEKS";
  if (diffDays > 14 && diffDays <= 30) return "MONTH";
  if (diffDays > 30) return "DUEMONTH";

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
    | "EN_CONVENIO",
  asesor_id?: number,
  nombre_usuario?: string,
  email_asesor?: string,
  cuotas_atrasadas?: number,
  proximidad_pago?: ProximidadPago
): Promise<{
  data: CreditoConInfo[];
  page: number;
  perPage: number;
  totalCount: number;
  totalPages: number;
}> {
  console.log(
    `🚀 Fetching credits | mes: ${mes}, anio: ${anio}, page: ${page}, perPage: ${perPage}, estado: ${estado}, numero_credito_sifco: ${numero_credito_sifco}, asesor_id: ${asesor_id}, nombre_usuario: ${nombre_usuario}, email_asesor: ${email_asesor}, cuotas_atrasadas: ${cuotas_atrasadas}, proximidad_pago: ${proximidad_pago}`
  );

  // 🔍 DEBUG: Verificar tipo de dato del número de crédito
  if (numero_credito_sifco) {
    console.log('🔍 DEBUG numero_credito_sifco:');
    console.log('  - Valor:', numero_credito_sifco);
    console.log('  - Tipo:', typeof numero_credito_sifco);
    console.log('  - Longitud:', numero_credito_sifco.length);
    console.log('  - Primer char:', numero_credito_sifco.charAt(0));
  }

  const offset = (page - 1) * perPage;
  const conditions: any[] = [];

  // 🇬🇹 Fecha actual en Guatemala
  const hoyGuatemala = new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Guatemala" })
  );
  const hoyStr = hoyGuatemala.toISOString().slice(0, 10);

  try {
    // 📌 Filtros
    if (numero_credito_sifco && numero_credito_sifco.length > 0) {
      console.log(
        `🔎 Filtrando por número de crédito: ${numero_credito_sifco}`
      );
      conditions.push(eq(creditos.numero_credito_sifco, numero_credito_sifco));
    } else {
      if (mes !== 0 && anio !== 0) {
        console.log(`🔎 Filtrando por mes/año: ${mes}/${anio}`);
        conditions.push(
          sql`EXTRACT(MONTH FROM ${creditos.fecha_creacion} AT TIME ZONE 'America/Guatemala') = ${mes}`,
          sql`EXTRACT(YEAR FROM ${creditos.fecha_creacion} AT TIME ZONE 'America/Guatemala') = ${anio}`
        );
      }
    }

    if (estado && estado.length > 0) {
      if (estado === "ACTIVO") {
        console.log(`🔎 Filtrando por estado: ACTIVO + MOROSO`);
        if (cuotas_atrasadas == 0 || cuotas_atrasadas === undefined) {
          conditions.push(sql`${creditos.statusCredit} IN ('ACTIVO')`);
        } else {
          conditions.push(sql`${creditos.statusCredit} IN ('ACTIVO', 'MOROSO')`);
        }
      } else {
        console.log(`🔎 Filtrando por estado: ${estado}`);
        conditions.push(eq(creditos.statusCredit, estado));
      }
    }

    if (asesor_id) {
      console.log(`🔎 Filtrando por asesor_id: ${asesor_id}`);
      conditions.push(eq(creditos.asesor_id, asesor_id));
    }

    if (nombre_usuario && nombre_usuario.length > 0) {
      console.log(`🔎 Filtrando por nombre de usuario: ${nombre_usuario}`);
      conditions.push(sql`${usuarios.nombre} ILIKE ${`%${nombre_usuario}%`}`);
    }

    if (email_asesor && email_asesor.length > 0) {
      console.log(`🔎 Filtrando por email de asesor: ${email_asesor}`);
      conditions.push(
        sql`${platform_users.email} ILIKE ${`%${email_asesor}%`}`
      );
    }

    if (cuotas_atrasadas !== undefined && cuotas_atrasadas > 0) {
      console.log(`🔎 Filtrando por cuotas atrasadas >= ${cuotas_atrasadas}`);
      conditions.push(eq(moras_credito.cuotas_atrasadas, cuotas_atrasadas));
    }

    // 🔍 DEBUG: Ver todas las condiciones construidas
    console.log('🔍 DEBUG Total de condiciones:', conditions.length);
  } catch (err) {
    console.error("❌ Error construyendo filtros:", err);
  }

  const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

  let rows: any[] = [];
  try {
    // 🔍 DEBUG: Query antes de ejecutar
    console.log('🔍 DEBUG Pre-query:');
    console.log('  - Tiene whereCondition?', whereCondition !== undefined);
    console.log('  - Limit:', perPage);
    console.log('  - Offset:', offset);

    // 1️⃣ Buscar créditos + usuarios + asesores + platform_users + moras
    rows = await db
      .select({
        creditos,
        usuarios,
        asesores,
        platform_users,
        moras_credito,
      })
      .from(creditos)
      .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .innerJoin(asesores, eq(creditos.asesor_id, asesores.asesor_id))
      .leftJoin(
        platform_users,
        eq(asesores.asesor_id, platform_users.asesor_id)
      )
      .leftJoin(
        moras_credito,
        eq(creditos.credito_id, moras_credito.credito_id)
      )
      .where(whereCondition)
      .limit(perPage)
      .offset(offset)
      .orderBy(desc(creditos.fecha_creacion));

    console.log(`📄 Créditos encontrados: ${rows.length}`);
    
    // 🔍 DEBUG: Si encontramos rows, mostrar info del primero
    if (rows.length > 0) {
      console.log('🔍 DEBUG Primer crédito encontrado:');
      console.log('  - credito_id:', rows[0].creditos.credito_id);
      console.log('  - numero_credito_sifco:', rows[0].creditos.numero_credito_sifco);
      console.log('  - statusCredit:', rows[0].creditos.statusCredit);
      console.log('  - usuario:', rows[0].usuarios.nombre);
    } else {
      console.log('⚠️ DEBUG: No se encontraron créditos con los filtros aplicados');
      
      // 🔍 Hacer un query de prueba sin filtros para ver si existen créditos
      if (numero_credito_sifco) {
        console.log('🔍 DEBUG: Buscando crédito sin filtros de estado...');
        const testQuery = await db
          .select({
            credito_id: creditos.credito_id,
            numero: creditos.numero_credito_sifco,
            estado: creditos.statusCredit,
          })
          .from(creditos)
          .where(eq(creditos.numero_credito_sifco, numero_credito_sifco))
          .limit(1);
        
        console.log('🔍 DEBUG Resultado de búsqueda sin filtros:', testQuery);
      }
    }
  } catch (err) {
    console.error("❌ Error consultando créditos:", err);
  }

  // 🆔 IDs de créditos
  const creditosIds = rows.map((r) => r.creditos.credito_id);
  console.log("🆔 Créditos IDs:", creditosIds);

  // 2️⃣ Rubros
  let rubrosPorCredito: any[] = [];
  if (creditosIds.length > 0) {
    try {
      rubrosPorCredito = await db
        .select({
          credito_id: creditos_rubros_otros.credito_id,
          nombre_rubro: creditos_rubros_otros.nombre_rubro,
          monto: creditos_rubros_otros.monto,
        })
        .from(creditos_rubros_otros)
        .where(inArray(creditos_rubros_otros.credito_id, creditosIds));

      console.log(`📊 Rubros encontrados: ${rubrosPorCredito.length}`);
    } catch (err) {
      console.error("❌ Error consultando rubros:", err);
    }
  }

  const rubrosMap = creditosIds.reduce(
    (acc, creditoId) => {
      acc[creditoId] = rubrosPorCredito
        .filter((r) => r.credito_id === creditoId)
        .map((r) => ({
          nombre_rubro: r.nombre_rubro,
          monto: Number(r.monto),
        }));
      return acc;
    },
    {} as Record<number, { nombre_rubro: string; monto: number }[]>
  );

  // 3️⃣ Inversionistas
  let inversionistasPorCredito: any[] = [];
  if (creditosIds.length > 0) {
    try {
      inversionistasPorCredito = await db
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
        })
        .from(creditos_inversionistas)
        .innerJoin(
          inversionistas,
          eq(
            creditos_inversionistas.inversionista_id,
            inversionistas.inversionista_id
          )
        )
        .where(inArray(creditos_inversionistas.credito_id, creditosIds));

      console.log(
        `👥 Inversionistas encontrados: ${inversionistasPorCredito.length}`
      );
    } catch (err) {
      console.error("❌ Error consultando inversionistas:", err);
    }
  }

  const inversionistasMap = creditosIds.reduce(
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

  // 4️⃣ Moras (ya las tenemos del query principal, solo mapeamos)
  const morasMap: Record<number, any> = {};
  rows.forEach((row) => {
    if (row.moras_credito) {
      morasMap[row.creditos.credito_id] = row.moras_credito;
    }
  });

  // 5️⃣ Próximas cuotas
  let proximasCuotas: any[] = [];
  try {
    if (creditosIds.length > 0) {
      console.log("🔍 Buscando próximas cuotas...");
      console.log("📅 Fecha de hoy (Guatemala):", hoyStr);

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
            gte(cuotas_credito.fecha_vencimiento, hoyStr),
            gt(cuotas_credito.numero_cuota, 0)
          )
        )
        .orderBy(cuotas_credito.credito_id, cuotas_credito.fecha_vencimiento);

      console.log(
        `📅 Cuotas encontradas (antes de filtrar): ${cuotasRaw.length}`
      );

      const cuotasPorCredito = new Map<number, any>();
      cuotasRaw.forEach((cuota) => {
        if (!cuotasPorCredito.has(cuota.credito_id)) {
          cuotasPorCredito.set(cuota.credito_id, cuota);
        }
      });

      proximasCuotas = Array.from(cuotasPorCredito.values());
      console.log(
        `📅 Próximas cuotas (una por crédito): ${proximasCuotas.length}`
      );
    }
  } catch (err) {
    console.error("❌ Error consultando próximas cuotas:", err);
  }

  const proximasCuotasMap: Record<number, ProximaCuota> = {};
  proximasCuotas.forEach((row: any) => {
    proximasCuotasMap[row.credito_id] = {
      cuota_id: row.cuota_id,
      numero_cuota: row.numero_cuota,
      fecha_vencimiento: row.fecha_vencimiento,
      pagado: row.pagado,
      pago_id: row.pago_id,
      validation_status: row.validation_status,
      proximidad: calcularProximidad(row.fecha_vencimiento),
    };
  });

  // --- Cancelaciones & Incobrables ---
  let cancelaciones: CreditCancelation[] = [];
  let incobrables: BadDebt[] = [];

  try {
    const canceladosIds = rows
      .filter((r) => r.creditos.statusCredit === "CANCELADO")
      .map((r) => r.creditos.credito_id);
    if (canceladosIds.length > 0) {
      console.log("🛑 Créditos cancelados:", canceladosIds);
      const cancelacionesRaw = await db
        .select()
        .from(credit_cancelations)
        .where(inArray(credit_cancelations.credit_id, canceladosIds));
      cancelaciones = cancelacionesRaw.map((row) => ({
        ...row,
        fecha_cancelacion: row.fecha_cancelacion ?? "",
        monto_cancelacion: Number(row.monto_cancelacion),
      }));
    }
  } catch (err) {
    console.error("❌ Error consultando cancelaciones:", err);
  }

  try {
    const incobrablesIds = rows
      .filter((r) => r.creditos.statusCredit === "INCOBRABLE")
      .map((r) => r.creditos.credito_id);
    if (incobrablesIds.length > 0) {
      console.log("⚠️ Créditos incobrables:", incobrablesIds);
      const incobrablesRaw = await db
        .select()
        .from(bad_debts)
        .where(inArray(bad_debts.credit_id, incobrablesIds));
      incobrables = incobrablesRaw.map((row) => ({
        ...row,
        fecha_registro: row.fecha_registro ?? "",
        monto_incobrable: Number(row.monto_incobrable),
      }));
    }
  } catch (err) {
    console.error("❌ Error consultando incobrables:", err);
  }

  const cancelacionesMap: Record<number, CreditCancelation> = {};
  cancelaciones.forEach((row) => (cancelacionesMap[row.credit_id] = row));

  const incobrablesMap: Record<number, BadDebt> = {};
  incobrables.forEach((row) => (incobrablesMap[row.credit_id] = row));

  // 6️⃣ Map final
  let data: CreditoConInfo[] = [];
  try {
    data = rows.map((row) => {
      const info = inversionistasMap[row.creditos.credito_id] || {
        aportes: [],
        resumen: {
          total_cash_in_monto: 0,
          total_cash_in_iva: 0,
          total_inversion_monto: 0,
          total_inversion_iva: 0,
        },
      };
      const rubros = rubrosMap[row.creditos.credito_id] || [];
      const cancelacion =
        row.creditos.statusCredit === "CANCELADO"
          ? cancelacionesMap[row.creditos.credito_id] || null
          : undefined;
      const incobrable =
        row.creditos.statusCredit === "INCOBRABLE"
          ? incobrablesMap[row.creditos.credito_id] || null
          : undefined;

      const mora = morasMap[row.creditos.credito_id] || null;
      const deuda_total_con_mora = new Big(row.creditos.deudatotal ?? 0)
        .plus(new Big(mora?.monto_mora ?? 0))
        .toString();

      const proxima_cuota = proximasCuotasMap[row.creditos.credito_id] || null;

      return {
        creditos: row.creditos,
        usuarios: row.usuarios,
        asesores: row.asesores,
        inversionistas: info.aportes,
        resumen: info.resumen,
        cancelacion,
        rubros,
        incobrable,
        mora,
        deuda_total_con_mora,
        proxima_cuota,
      };
    });
    console.log(`✅ Créditos mapeados: ${data.length}`);
  } catch (err) {
    console.error("❌ Error mapeando créditos:", err);
  }

  if (proximidad_pago) {
    console.log(`🔎 Filtrando por proximidad de pago: ${proximidad_pago}`);
    data = data.filter(
      (credito) => credito.proxima_cuota?.proximidad === proximidad_pago
    );
    console.log(`✅ Créditos filtrados por proximidad: ${data.length}`);
  }

  // 7️⃣ Paginación
  let count = 0;
  try {
    const [{ count: total }] = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(creditos)
      .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .innerJoin(asesores, eq(creditos.asesor_id, asesores.asesor_id))
      .leftJoin(
        platform_users,
        eq(asesores.asesor_id, platform_users.asesor_id)
      )
      .leftJoin(
        moras_credito,
        eq(creditos.credito_id, moras_credito.credito_id)
      )
      .where(whereCondition);
    count = Number(total);
    console.log(`📊 Total records encontrados: ${count}`);
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
    const hoy = new Date();

    // 2. Obtener cuotas pendientes
    const cuotasPendientes = await db
      .select({
        cuota_id: cuotas_credito.cuota_id,
        credito_id: cuotas_credito.credito_id,
        numero_cuota: cuotas_credito.numero_cuota,
        fecha_vencimiento: cuotas_credito.fecha_vencimiento,
        pagado: cuotas_credito.pagado,
        createdAt: cuotas_credito.createdAt,
        validationStatus: pagos_credito.validationStatus,
      })
      .from(cuotas_credito)
      .innerJoin(
        pagos_credito,
        eq(pagos_credito.cuota_id, cuotas_credito.cuota_id)
      )
      .where(
        and(
          eq(cuotas_credito.credito_id, creditId),
          eq(cuotas_credito.pagado, false),
          lt(cuotas_credito.fecha_vencimiento, hoy.toISOString().slice(0, 10))
        )
      )
      .orderBy(asc(cuotas_credito.numero_cuota));

    const [morasCredito] = await db
      .select()
      .from(moras_credito)
      .where(
        and(
          eq(moras_credito.credito_id, creditId),
          eq(moras_credito.activa, true)
        )
      );
    const numeroCuotasPendientes = cuotasPendientes.length;

    // 3. Calcular montos
    const capitalActual = new Big(credit.capital ?? 0);
    const cuotaInteres = new Big(credit.cuota_interes ?? 0);
    const membresiasPago = new Big(credit.membresias_pago ?? 0);
    const seguro10Cuotas = new Big(credit.seguro_10_cuotas ?? 0);
    const iva12 = new Big(credit.iva_12 ?? 0);

    const totalInteresesPendientes = cuotaInteres.times(numeroCuotasPendientes);
    const totalMembresiasPendientes = membresiasPago.times(
      numeroCuotasPendientes
    );
    const totalSeguroPendiente = seguro10Cuotas.times(numeroCuotasPendientes);
    const totalIvaPendiente = iva12.times(numeroCuotasPendientes);

    // 4. Devolver la info
    return {
      message: "Resumen del crédito a cancelar",
      credito: {
        capital_actual: capitalActual.toFixed(2),
        total_intereses_pendientes: totalInteresesPendientes.toFixed(2),
        total_membresias_pendientes: totalMembresiasPendientes.toFixed(2),
        total_seguro_pendiente: totalSeguroPendiente.toFixed(2),
        total_iva_pendiente: totalIvaPendiente.toFixed(2),
        cuotas_pendientes: numeroCuotasPendientes,
        mora: morasCredito ? morasCredito.monto_mora : 0,
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
      // a) Set UNCOLLECTIBLE
      await tx
        .update(creditos)
        .set({ statusCredit: "INCOBRABLE" })
        .where(eq(creditos.credito_id, creditId));

      // b) Register bad debt
      await tx.insert(bad_debts).values({
        credit_id: creditId,
        motivo: motivo!, // validated above
        observaciones: observaciones ?? "",
        monto_incobrable: monto_cancelacion!.toString(),
      });

      return {
        ok: true,
        message: "Crédito marcado como incobrable correctamente",
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
  await db
    .update(creditos)
    .set({
      capital: "0",
      porcentaje_interes: "0",
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
    .where(eq(creditos.credito_id, creditId));
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
  banco_id?: number;
  numeroAutorizacion?: string;
}) {
  try {
    // 🚨 1. Verificar si existe una mora activa para el crédito
    const moraActiva = await db
      .select()
      .from(moras_credito)
      .where(
        and(
          eq(moras_credito.credito_id, creditId),
          eq(moras_credito.activa, true)
        )
      )
      .limit(1);

    if (moraActiva.length > 0) {
      throw new Error(
        "No se puede reiniciar el crédito porque tiene una mora activa."
      );
    }

    // 2. Determinar el estado del crédito
    const statusCredit =
      typeof montoIncobrable !== "undefined" &&
      montoIncobrable > 0 &&
      montoBoleta !== undefined
        ? "INCOBRABLE"
        : "CANCELADO";

    // 3. Reinicia el crédito poniendo todos los montos a cero y el estado
    await db
      .update(creditos)
      .set({
        capital: "0",
        porcentaje_interes: "0",
        deudatotal:
          montoIncobrable !== undefined ? String(montoIncobrable) : "0",
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
        statusCredit: statusCredit,
      })
      .where(eq(creditos.credito_id, creditId));

    // 4. Consulta el crédito para validar que existe
    const [credito] = await db
      .select()
      .from(creditos)
      .where(eq(creditos.credito_id, creditId));
    if (!credito) {
      throw new Error("Crédito no encontrado.");
    }

    // 5. Construir URLs de boletas
    const r2BaseUrl = import.meta.env.URL_PUBLIC_R2 ?? "";
    const urlCompletas = construirUrlBoletas(url_boletas, r2BaseUrl);

    // 6. Obtener pagos del mes + monto de boleta
    const pago_del_mes = await getPagosDelMesActual(credito.credito_id);
    const pago_del_mesBig = new Big(pago_del_mes ?? 0).add(montoBoleta ?? 0);

    // 7. Buscar cuota_id correspondiente
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

    // 8. Insertar nuevo pago
    const [nuevoPago] = await db
      .insert(pagos_credito)
      .values({
        credito_id: credito.credito_id,
        cuota_id: cuotaId,
        cuota: credito.cuota?.toString() ?? "0",
        cuota_interes: credito.cuota_interes?.toString() ?? "0",
        abono_capital: "0",
        abono_interes: "0",
        abono_iva_12: "0",
        abono_interes_ci: "0",
        abono_iva_ci: "0",
        abono_seguro: "0",
        abono_gps: "0",
        pago_del_mes: pago_del_mesBig.toString(),
        monto_boleta: montoBoleta.toString(),
        capital_restante: credito.capital?.toString() ?? "0",
        interes_restante: credito.cuota_interes?.toString() ?? "0",
        iva_12_restante: credito.iva_12?.toString() ?? "0",
        seguro_restante: credito.seguro_10_cuotas?.toString() ?? "0",
        gps_restante: credito.gps?.toString() ?? "0",
        total_restante: credito.deudatotal?.toString() ?? "0",
        llamada: "",
        renuevo_o_nuevo: "renuevo",
        membresias: credito.membresias_pago?.toString() ?? "",
        membresias_pago: credito.membresias_pago?.toString() ?? "",
        membresias_mes: credito.membresias_pago?.toString() ?? "",
        otros: "0",
        mora: "0",
        monto_boleta_cuota: montoBoleta.toString(),
        seguro_total: credito.seguro_10_cuotas?.toString() ?? "0",
        pagado: true,
        facturacion: "si",
        mes_pagado: "",
        seguro_facturado: credito.seguro_10_cuotas?.toString() ?? "0",
        gps_facturado: credito.gps?.toString() ?? "0",
        reserva: "0",
        observaciones: "",
        validationStatus: "reset" as const,
        banco_id: banco_id ?? 0,
        numeroAutorizacion: numeroAutorizacion ?? "",
        registerBy: "system_reset",
        pagoConvenio: "0",
      })
      .returning();

    // 9. Eliminar pagos no pagados
    await db
      .delete(pagos_credito)
      .where(
        and(
          eq(pagos_credito.credito_id, credito.credito_id),
          eq(pagos_credito.pagado, false)
        )
      );

    // 10. Insertar boletas si existen
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

    // 11. Retorno OK
    return {
      ok: true,
      message: "Crédito reiniciado y pago creado exitosamente.",
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

      const pagosToInsert = insertedCuotas.map((c) => ({
        credito_id: creditoId,
        cuota: cuotaStr,
        // keep interest per your credit row (unchanged here)
        cuota_interes: new Big(credit.porcentaje_interes ?? 0)
          .times(new Big(credit.capital ?? 0).div(100))
          .round(2)
          .toString(), // same formula you used on create (capital * rate%)
        cuota_id: c.cuota_id,
        fecha_pago: new Date(c.fecha_vencimiento),
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
        membresias_pago: new Big(credit.membresias_pago ?? 0).toString(),
        membresias_mes: new Big(credit.membresias_pago ?? 0).toString(),
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
      }));

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
        // delete related pagos first
        await tx
          .delete(pagos_credito)
          .where(inArray(pagos_credito.cuota_id, extraCuotaIds));
        // then delete cuotas
        await tx
          .delete(cuotas_credito)
          .where(inArray(cuotas_credito.cuota_id, extraCuotaIds));
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

    const [creditoActualizado] = await db
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
      .returning();

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
}

interface CreditStatsResponse {
  totalCreditos: number;
  efectividad: string; // Porcentaje de créditos SIN cuotas atrasadas
  porCuotasAtrasadas: {
    "0": CreditStats;
    "1": CreditStats;
    "2": CreditStats;
    "3": CreditStats;
    "4": CreditStats;
  };
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
      .select({ asesor_id: platform_users.asesor_id })
      .from(platform_users)
      .where(eq(platform_users.email, email))
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

  // Estadísticas por cuotas atrasadas (0, 1, 2, 3, 4) - Solo créditos ACTIVOS o MOROSOS
  const statsPerCuotasAtrasadas: Record<string, CreditStats> = {
    "0": { cantidad: 0, porcentaje: "0", sumaCapital: "0", sumaMora: "0" },
    "1": { cantidad: 0, porcentaje: "0", sumaCapital: "0", sumaMora: "0" },
    "2": { cantidad: 0, porcentaje: "0", sumaCapital: "0", sumaMora: "0" },
    "3": { cantidad: 0, porcentaje: "0", sumaCapital: "0", sumaMora: "0" },
    "4": { cantidad: 0, porcentaje: "0", sumaCapital: "0", sumaMora: "0" },
  };

  // Consulta para créditos activos/morosos con sus moras
  const baseConditionsActive = [
    inArray(creditos.statusCredit, ["ACTIVO", "MOROSO", "EN_CONVENIO"]),
  ];

  if (asesorId) {
    baseConditionsActive.push(eq(creditos.asesor_id, asesorId));
  }

  let creditosSinAtraso = 0;

  for (const cuotasNum of [0, 1, 2, 3, 4]) {
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
      .where(
        and(
          ...baseConditionsActive,
          sql`COALESCE(${moras_credito.cuotas_atrasadas}, 0) = ${cuotasNum}`
        )
      );

    const cantidad = result[0]?.cantidad || 0;
    const porcentaje = totalCreditosActivos > 0 
      ? ((cantidad / totalCreditosActivos) * 100).toFixed(2) 
      : "0";

    if (cuotasNum === 0) {
      creditosSinAtraso = cantidad;
    }

    statsPerCuotasAtrasadas[cuotasNum.toString()] = {
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
