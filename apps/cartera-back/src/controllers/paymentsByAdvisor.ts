import { db } from "../database/index";
import {
  asesores,
  convenio_cuotas,
  convenios_pago,
  creditos,
  cuotas_credito,
  efectividad_asesores,
  usuarios,
} from "../database/db/schema";
import { and, eq, sql, inArray } from "drizzle-orm";
import Big from "big.js";

/**
 * Obtiene los créditos que tienen cuota con vencimiento en un día específico,
 * filtrado por asesor, e indica si la cuota está pagada o no.
 *
 * @param dia - Día del mes (1-31)
 * @param mes - Mes (1-12)
 * @param anio - Año (ej: 2026)
 * @param asesorId - ID del asesor (opcional, si no se envía trae todos)
 */
export const getCuotasPorDiaYAsesor = async (
  dia: number,
  mes: number,
  anio: number,
  asesorId?: number
) => {
  try {
    // Construir condiciones
    const conditions = [
      sql`EXTRACT(DAY FROM ${cuotas_credito.fecha_vencimiento}::date) = ${dia}`,
      sql`EXTRACT(MONTH FROM ${cuotas_credito.fecha_vencimiento}::date) = ${mes}`,
      sql`EXTRACT(YEAR FROM ${cuotas_credito.fecha_vencimiento}::date) = ${anio}`,
      // Solo créditos activos / morosos / en convenio
      inArray(creditos.statusCredit, [
        "ACTIVO",
        "MOROSO",
        "EN_CONVENIO",
      ]),
    ];

    if (asesorId) {
      conditions.push(eq(creditos.asesor_id, asesorId));
    }

    const results = await db
      .select({
        // Asesor
        asesor_id: asesores.asesor_id,
        asesor_nombre: asesores.nombre,
        // Crédito
        credito_id: creditos.credito_id,
        numero_credito_sifco: creditos.numero_credito_sifco,
        capital: creditos.capital,
        cuota: creditos.cuota,
        statusCredit: creditos.statusCredit,
        // Usuario
        usuario_nombre: usuarios.nombre,
        // Cuota
        cuota_id: cuotas_credito.cuota_id,
        numero_cuota: cuotas_credito.numero_cuota,
        fecha_vencimiento: cuotas_credito.fecha_vencimiento,
        pagado: cuotas_credito.pagado,
        // Convenio (si existe uno activo)
        convenio_id: convenios_pago.convenio_id,
        fecha_convenio: convenios_pago.fecha_convenio,
        cuota_convenio: convenios_pago.cuota_mensual,
        monto_total_convenio: convenios_pago.monto_total_convenio,
        monto_pagado_convenio: convenios_pago.monto_pagado,
        monto_pendiente_convenio: convenios_pago.monto_pendiente,
        pagos_realizados_convenio: convenios_pago.pagos_realizados,
        pagos_pendientes_convenio: convenios_pago.pagos_pendientes,
        // Cuota del convenio del mes
        cuota_convenio_id: convenio_cuotas.cuota_convenio_id,
        numero_cuota_convenio: convenio_cuotas.numero_cuota,
        fecha_vencimiento_convenio: convenio_cuotas.fecha_vencimiento,
        fecha_pago_convenio: convenio_cuotas.fecha_pago,
      })
      .from(cuotas_credito)
      .innerJoin(creditos, eq(cuotas_credito.credito_id, creditos.credito_id))
      .innerJoin(asesores, eq(creditos.asesor_id, asesores.asesor_id))
      .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .leftJoin(
        convenios_pago,
        and(
          eq(convenios_pago.credito_id, creditos.credito_id),
          eq(convenios_pago.activo, true)
        )
      )
      .leftJoin(
        convenio_cuotas,
        and(
          eq(convenio_cuotas.convenio_id, convenios_pago.convenio_id),
          sql`EXTRACT(MONTH FROM ${convenio_cuotas.fecha_vencimiento}::date) = ${mes}`,
          sql`EXTRACT(YEAR FROM ${convenio_cuotas.fecha_vencimiento}::date) = ${anio}`
        )
      )
      .where(and(...conditions));

    // Agrupar por asesor
    const porAsesor: Record<
      number,
      {
        asesor_id: number;
        asesor_nombre: string;
        cuotas: {
          credito_id: number;
          numero_credito_sifco: string;
          capital: string;
          cuota: string;
          statusCredit: string | null;
          usuario_nombre: string;
          cuota_id: number;
          numero_cuota: number;
          fecha_vencimiento: string;
          pagado: boolean | null;
          convenio: {
            convenio_id: number;
            fecha_convenio: Date;
            cuota_mensual: string;
            monto_total: string;
            monto_pagado: string;
            monto_pendiente: string;
            pagos_realizados: number;
            pagos_pendientes: number;
            cuota_del_mes: {
              cuota_convenio_id: number;
              numero_cuota: number;
              fecha_vencimiento: string;
              pagada: boolean;
            } | null;
          } | null;
        }[];
      }
    > = {};

    for (const row of results) {
      if (!porAsesor[row.asesor_id]) {
        porAsesor[row.asesor_id] = {
          asesor_id: row.asesor_id,
          asesor_nombre: row.asesor_nombre,
          cuotas: [],
        };
      }
      // Sin repetir asesor_id y asesor_nombre en cada cuota
      porAsesor[row.asesor_id].cuotas.push({
        credito_id: row.credito_id,
        numero_credito_sifco: row.numero_credito_sifco,
        capital: row.capital,
        cuota: row.cuota,
        statusCredit: row.statusCredit,
        usuario_nombre: row.usuario_nombre,
        cuota_id: row.cuota_id,
        numero_cuota: row.numero_cuota,
        fecha_vencimiento: row.fecha_vencimiento,
        pagado: row.pagado,
        convenio: row.convenio_id
          ? {
              convenio_id: row.convenio_id,
              fecha_convenio: row.fecha_convenio!,
              cuota_mensual: row.cuota_convenio!,
              monto_total: row.monto_total_convenio!,
              monto_pagado: row.monto_pagado_convenio!,
              monto_pendiente: row.monto_pendiente_convenio!,
              pagos_realizados: row.pagos_realizados_convenio!,
              pagos_pendientes: row.pagos_pendientes_convenio!,
              cuota_del_mes: row.cuota_convenio_id
                ? {
                    cuota_convenio_id: row.cuota_convenio_id,
                    numero_cuota: row.numero_cuota_convenio!,
                    fecha_vencimiento: row.fecha_vencimiento_convenio!,
                    pagada: row.fecha_pago_convenio !== null,
                  }
                : null,
            }
          : null,
      });
    }

    // Helper: monto efectivo = cuota normal + cuota convenio si tiene
    const montoEfectivo = (c: { cuota: string; convenio: { cuota_mensual: string } | null }) =>
      c.convenio ? new Big(c.cuota).plus(c.convenio.cuota_mensual).toString() : c.cuota;

    const data = Object.values(porAsesor).map((asesor) => {
      const pagadas = asesor.cuotas.filter((c) => c.pagado);
      const pendientes = asesor.cuotas.filter((c) => !c.pagado);

      const montoPagado = pagadas.reduce((acc, c) => acc.plus(montoEfectivo(c)), new Big(0));
      const montoPendiente = pendientes.reduce((acc, c) => acc.plus(montoEfectivo(c)), new Big(0));
      const montoTotal = montoPagado.plus(montoPendiente);

      return {
        ...asesor,
        resumen: {
          total_cuotas: asesor.cuotas.length,
          pagadas: pagadas.length,
          pendientes: pendientes.length,
          monto_total: montoTotal.toFixed(2),
          monto_pagado: montoPagado.toFixed(2),
          monto_pendiente: montoPendiente.toFixed(2),
        },
      };
    });

    // Resumen general del día - usar monto efectivo (convenio si existe)
    const allCuotas = Object.values(porAsesor).flatMap((a) => a.cuotas);
    const totalCuotas = allCuotas.length;
    const totalPagadas = allCuotas.filter((r) => r.pagado).length;
    const totalPendientes = allCuotas.filter((r) => !r.pagado).length;
    const montoTotalDia = allCuotas.reduce((acc, r) => acc.plus(montoEfectivo(r)), new Big(0));
    const montoPagadoDia = allCuotas.filter((r) => r.pagado).reduce((acc, r) => acc.plus(montoEfectivo(r)), new Big(0));
    const montoPendienteDia = allCuotas.filter((r) => !r.pagado).reduce((acc, r) => acc.plus(montoEfectivo(r)), new Big(0));

    return {
      ok: true,
      dia,
      mes,
      anio,
      asesor_id: asesorId ?? null,
      resumen_dia: {
        total_cuotas: totalCuotas,
        pagadas: totalPagadas,
        pendientes: totalPendientes,
        monto_total: montoTotalDia.toFixed(2),
        monto_pagado: montoPagadoDia.toFixed(2),
        monto_pendiente: montoPendienteDia.toFixed(2),
      },
      data,
    };
  } catch (error) {
    console.error("[getCuotasPorDiaYAsesor] Error:", error);
    return { ok: false, error: "Error obteniendo cuotas por día y asesor", details: String(error) };
  }
};

/**
 * Job que recorre desde el día 1 hasta el día indicado,
 * obtiene la data de cada día y hace upsert en efectividad_asesores.
 *
 * - efectividad_dia: solo se escribe en el INSERT (primera vez), nunca se actualiza.
 * - efectividad (acumulada del mes): se recalcula y actualiza en cada corrida.
 */
export const upsertEfectividadAsesores = async (
  dia: number,
  mes: number,
  anio: number
) => {
  try {
    console.log(`[JOB] ========== INICIO upsertEfectividadAsesores dia=1..${dia}, mes=${mes}, anio=${anio} ==========`);

    // Acumulador por asesor para calcular efectividad mensual
    const acumulado: Record<
      number,
      { totalCuotas: number; cuotasPagadas: number }
    > = {};

    for (let d = 1; d <= dia; d++) {
      console.log(`[JOB] --- Procesando dia ${d}/${dia} ---`);
      const result = await getCuotasPorDiaYAsesor(d, mes, anio);

      // Fecha Guatemala para este día
      const fechaGuate = new Date(
        new Date(`${anio}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}T12:00:00-06:00`)
      );

      if (result.ok && result.data) {
        console.log(`[JOB]   Dia ${d}: ${result.data.length} asesores con cuotas`);
        for (const asesor of result.data) {
          const { asesor_id, resumen } = asesor;
          console.log(`[JOB]   Asesor ${asesor_id}: total_cuotas=${resumen.total_cuotas}, pagadas=${resumen.pagadas}, pendientes=${resumen.pendientes}, creditos=${asesor.cuotas.length}`);

          // Acumular para efectividad mensual
          if (!acumulado[asesor_id]) {
            acumulado[asesor_id] = { totalCuotas: 0, cuotasPagadas: 0 };
          }
          acumulado[asesor_id].totalCuotas += resumen.total_cuotas;
          acumulado[asesor_id].cuotasPagadas += resumen.pagadas;

          const efectividadDia =
            resumen.total_cuotas > 0
              ? new Big(resumen.pagadas)
                  .div(resumen.total_cuotas)
                  .times(100)
                  .toFixed(2)
              : "0.00";

          const efectividadMes =
            acumulado[asesor_id].totalCuotas > 0
              ? new Big(acumulado[asesor_id].cuotasPagadas)
                  .div(acumulado[asesor_id].totalCuotas)
                  .times(100)
                  .toFixed(2)
              : "0.00";

          console.log(`[JOB]     efectividad_dia=${efectividadDia}%, efectividad_mes=${efectividadMes}%`);

          // Upsert por cada crédito del asesor ese día (ignorar cuota #0)
          for (const cuota of asesor.cuotas) {
            if (cuota.numero_cuota <= 0) continue;
            const existing = await db
              .select({ efectividad_id: efectividad_asesores.efectividad_id })
              .from(efectividad_asesores)
              .where(
                and(
                  eq(efectividad_asesores.asesor_id, asesor_id),
                  eq(efectividad_asesores.credito_id, cuota.credito_id),
                  eq(efectividad_asesores.dia, d),
                  eq(efectividad_asesores.mes, mes),
                  eq(efectividad_asesores.anio, anio)
                )
              )
              .limit(1);

            const montoEfectivo = cuota.convenio
              ? new Big(cuota.cuota).plus(cuota.convenio.cuota_mensual).toFixed(2)
              : cuota.cuota;

            console.log(`[JOB]       credito=${cuota.credito_id}, cuota#${cuota.numero_cuota}, pagado=${cuota.pagado}, monto=${montoEfectivo}, existing=${existing.length > 0 ? "UPDATE" : "INSERT"}`);

            if (existing.length > 0) {
              // UPDATE: actualizar pagado, montos y efectividad acumulada, NO efectividad_dia
              await db
                .update(efectividad_asesores)
                .set({
                  total_cuotas: 1, // Cada fila = 1 cuota de 1 crédito
                  cuotas_pagadas: cuota.pagado ? 1 : 0,
                  cuotas_pendientes: cuota.pagado ? 0 : 1,
                  monto_esperado: montoEfectivo,
                  monto_cobrado: cuota.pagado ? montoEfectivo : "0.00",
                  monto_pendiente: cuota.pagado ? "0.00" : montoEfectivo,
                  efectividad: efectividadMes,
                })
                .where(eq(efectividad_asesores.efectividad_id, existing[0].efectividad_id));
            } else {
              // INSERT: guardar todo incluyendo efectividad_dia
              await db.insert(efectividad_asesores).values({
                asesor_id,
                credito_id: cuota.credito_id,
                dia: d,
                mes,
                anio,
                fecha: fechaGuate,
                total_cuotas: 1, // Cada fila = 1 cuota de 1 crédito
                cuotas_pagadas: cuota.pagado ? 1 : 0,
                cuotas_pendientes: cuota.pagado ? 0 : 1,
                monto_esperado: montoEfectivo,
                monto_cobrado: cuota.pagado ? montoEfectivo : "0.00",
                monto_pendiente: cuota.pagado ? "0.00" : montoEfectivo,
                efectividad_dia: efectividadDia,
                efectividad: efectividadMes,
              });
            }
          }
        }
      }

    }

    console.log(`[JOB] ========== FIN upsertEfectividadAsesores ==========`);
    console.log(`[JOB] Acumulado final:`, JSON.stringify(acumulado, null, 2));
    return { ok: true, mensaje: `Efectividad actualizada del día 1 al ${dia} de ${mes}/${anio}` };
  } catch (error) {
    console.error("[upsertEfectividadAsesores] Error:", error);
    return { ok: false, error: "Error actualizando efectividad", details: String(error) };
  }
};

/**
 * Consulta la tabla efectividad_asesores filtrando por mes/anio,
 * y opcionalmente por asesor_id.
 */
export const getEfectividadAsesores = async (
  mes: number,
  anio: number,
  asesorId?: number,
  dia?: number
) => {
  try {
    const conditions = [
      eq(efectividad_asesores.mes, mes),
      eq(efectividad_asesores.anio, anio),
    ];

    if (asesorId) {
      conditions.push(eq(efectividad_asesores.asesor_id, asesorId));
    }

    // Si viene día específico, filtrar solo ese día
    if (dia) {
      conditions.push(eq(efectividad_asesores.dia, dia));
    }

    const rows = await db
      .select({
        asesor_id: efectividad_asesores.asesor_id,
        asesor_nombre: asesores.nombre,
        credito_id: efectividad_asesores.credito_id,
        numero_credito_sifco: creditos.numero_credito_sifco,
        usuario_nombre: usuarios.nombre,
        statusCredit: creditos.statusCredit,
        total_cuotas: sql<number>`SUM(${efectividad_asesores.total_cuotas})`.as("total_cuotas"),
        cuotas_pagadas: sql<number>`SUM(${efectividad_asesores.cuotas_pagadas})`.as("cuotas_pagadas"),
        cuotas_pendientes: sql<number>`SUM(${efectividad_asesores.cuotas_pendientes})`.as("cuotas_pendientes"),
        monto_esperado: sql<string>`SUM(${efectividad_asesores.monto_esperado}::numeric)`.as("monto_esperado"),
        monto_cobrado: sql<string>`SUM(${efectividad_asesores.monto_cobrado}::numeric)`.as("monto_cobrado"),
        monto_pendiente: sql<string>`SUM(${efectividad_asesores.monto_pendiente}::numeric)`.as("monto_pendiente"),
        efectividad: sql<string>`MAX(${efectividad_asesores.efectividad})`.as("efectividad"),
      })
      .from(efectividad_asesores)
      .innerJoin(asesores, eq(efectividad_asesores.asesor_id, asesores.asesor_id))
      .leftJoin(creditos, eq(efectividad_asesores.credito_id, creditos.credito_id))
      .leftJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
      .where(and(...conditions))
      .groupBy(
        efectividad_asesores.asesor_id,
        asesores.nombre,
        efectividad_asesores.credito_id,
        creditos.numero_credito_sifco,
        usuarios.nombre,
        creditos.statusCredit,
      )
      .orderBy(efectividad_asesores.asesor_id, efectividad_asesores.credito_id);

    // Agrupar por asesor: totales + array de créditos
    const asesoresMap = new Map<number, {
      asesor_id: number;
      asesor_nombre: string;
      totales: {
        total_cuotas: number;
        cuotas_pagadas: number;
        cuotas_pendientes: number;
        monto_esperado: string;
        monto_cobrado: string;
        monto_pendiente: string;
        efectividad: string;
      };
      creditos: typeof rows;
    }>();

    for (const row of rows) {
      if (!asesoresMap.has(row.asesor_id)) {
        asesoresMap.set(row.asesor_id, {
          asesor_id: row.asesor_id,
          asesor_nombre: row.asesor_nombre,
          totales: {
            total_cuotas: 0,
            cuotas_pagadas: 0,
            cuotas_pendientes: 0,
            monto_esperado: "0",
            monto_cobrado: "0",
            monto_pendiente: "0",
            efectividad: "0.00",
          },
          creditos: [],
        });
      }

      const asesor = asesoresMap.get(row.asesor_id)!;
      asesor.creditos.push(row);

      // Sumar totales (ignorar filas con credito_id null para los montos)
      if (row.credito_id !== null) {
        asesor.totales.total_cuotas += Number(row.total_cuotas) || 0;
        asesor.totales.cuotas_pagadas += Number(row.cuotas_pagadas) || 0;
        asesor.totales.cuotas_pendientes += Number(row.cuotas_pendientes) || 0;
        asesor.totales.monto_esperado = new Big(asesor.totales.monto_esperado).plus(row.monto_esperado || "0").toFixed(2);
        asesor.totales.monto_cobrado = new Big(asesor.totales.monto_cobrado).plus(row.monto_cobrado || "0").toFixed(2);
        asesor.totales.monto_pendiente = new Big(asesor.totales.monto_pendiente).plus(row.monto_pendiente || "0").toFixed(2);
      }
    }

    // Calcular efectividad por asesor
    for (const asesor of asesoresMap.values()) {
      const { total_cuotas, cuotas_pagadas } = asesor.totales;
      asesor.totales.efectividad = total_cuotas > 0
        ? new Big(cuotas_pagadas).div(total_cuotas).times(100).toFixed(2)
        : "0.00";
    }

    const data = Array.from(asesoresMap.values());

    return {
      ok: true,
      ...(dia ? { dia } : {}),
      mes,
      anio,
      asesor_id: asesorId ?? null,
      total_asesores: data.length,
      data,
    };
  } catch (error) {
    console.error("[getEfectividadAsesores] Error:", error);
    return { ok: false, error: "Error consultando efectividad", details: String(error) };
  }
};
