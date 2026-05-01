import { db } from "../database/index";
import {
  creditos,
  pagos_credito,
  usuarios,
} from "../database/db/schema";
import { and, eq, sql } from "drizzle-orm";

export interface CreditoNuevoConAbono {
  credito_id: number;
  numero_credito_sifco: string;
  fecha_creacion: Date | string;
  cliente_nombre: string;
  capital: string;
  status_credit: string;
  total_pagos: number;
  pagos_con_abono: number;
  total_abono_capital: string;
  tiene_abonos: boolean;
  detalle_pagos: {
    pago_id: number;
    fecha_pago: Date | string | null;
    monto_boleta: string | null;
    abono_capital: string | null;
    abono_interes: string | null;
    abono_iva_12: string | null;
  }[];
}

/**
 * Diagnóstico: ejecuta raw SQL para verificar cuántos créditos y pagos
 * existen en la BD y qué rango de fechas tienen.
 * Útil para confirmar que el endpoint principal no tiene un bug de query.
 */
export async function diagnosticoCreditosAbonos() {
  // Total de créditos en la BD
  const totalCreditosResult = await db.execute<{ total: string }>(
    sql`SELECT COUNT(*) as total FROM cartera.creditos`
  );

  // Rango de fechas de los créditos
  const rangoFechasResult = await db.execute<{
    fecha_min: string;
    fecha_max: string;
  }>(
    sql`SELECT 
          MIN(fecha_creacion AT TIME ZONE 'America/Guatemala')::date::text as fecha_min,
          MAX(fecha_creacion AT TIME ZONE 'America/Guatemala')::date::text as fecha_max
        FROM cartera.creditos`
  );

  // Créditos agrupados por mes/año para ver la distribución real
  const creditosPorMesResult = await db.execute<{
    mes: string;
    total: string;
  }>(
    sql`SELECT 
          TO_CHAR(fecha_creacion AT TIME ZONE 'America/Guatemala', 'YYYY-MM') as mes,
          COUNT(*) as total
        FROM cartera.creditos
        GROUP BY TO_CHAR(fecha_creacion AT TIME ZONE 'America/Guatemala', 'YYYY-MM')
        ORDER BY mes DESC
        LIMIT 12`
  );

  // Total de pagos en BD y cuántos tienen abono_capital > 0
  const totalPagosResult = await db.execute<{
    total_pagos: string;
    con_abono_capital: string;
  }>(
    sql`SELECT
          COUNT(*) as total_pagos,
          COUNT(*) FILTER (WHERE CAST(abono_capital AS NUMERIC) > 0) as con_abono_capital
        FROM cartera.pagos_credito`
  );

  // ====================================================================
  // AUDITORÍA REAL: créditos nuevos (desde 2026-03-01) donde los pagos
  // tienen membresias_mes > 0 o membresias_pago > 0 pero el crédito
  // NO tiene ninguna cuota real pagada (solo tiene la cuota 0 como pagada)
  // ====================================================================
  const creditosMembresiasSinPagoResult = await db.execute<{
    credito_id: number;
    numero_credito_sifco: string;
    fecha_creacion: string;
    nombre: string;
    capital: string;
    cuotas_reales_pagadas: string;
    pagos_con_membresias_mes: string;
    pagos_con_membresias_pago: string;
    suma_membresias_mes: string;
    suma_membresias_pago: string;
  }>(
    sql`SELECT
          c.credito_id,
          c.numero_credito_sifco,
          (c.fecha_creacion AT TIME ZONE 'America/Guatemala')::date::text as fecha_creacion,
          u.nombre,
          c.capital,
          -- Cuántas cuotas reales (numero_cuota > 0) están pagadas
          (
            SELECT COUNT(*) 
            FROM cartera.cuotas_credito cc 
            WHERE cc.credito_id = c.credito_id 
              AND cc.numero_cuota > 0 
              AND cc.pagado = true
          ) as cuotas_reales_pagadas,
          -- Pagos con membresias_mes > 0
          COUNT(p.pago_id) FILTER (
            WHERE CAST(COALESCE(p.membresias_mes, '0') AS NUMERIC) > 0
          ) as pagos_con_membresias_mes,
          -- Pagos con membresias_pago > 0
          COUNT(p.pago_id) FILTER (
            WHERE CAST(COALESCE(p.membresias_pago, '0') AS NUMERIC) > 0
          ) as pagos_con_membresias_pago,
          -- Suma total
          COALESCE(SUM(CAST(COALESCE(p.membresias_mes, '0') AS NUMERIC)), 0)::text as suma_membresias_mes,
          COALESCE(SUM(CAST(COALESCE(p.membresias_pago, '0') AS NUMERIC)), 0)::text as suma_membresias_pago
        FROM cartera.creditos c
        INNER JOIN cartera.usuarios u ON u.usuario_id = c.usuario_id
        LEFT JOIN cartera.pagos_credito p ON p.credito_id = c.credito_id
        WHERE 
          (c.fecha_creacion AT TIME ZONE 'America/Guatemala')::date >= '2026-03-01'
        GROUP BY c.credito_id, c.numero_credito_sifco, c.fecha_creacion, u.nombre, c.capital
        HAVING 
          -- Que tenga pagos con membresias_mes o membresias_pago > 0
          (
            SUM(CAST(COALESCE(p.membresias_mes, '0') AS NUMERIC)) > 0
            OR SUM(CAST(COALESCE(p.membresias_pago, '0') AS NUMERIC)) > 0
          )
          -- Y que NO tenga cuotas reales pagadas (o sea, el cliente aún no ha pagado nada)
          AND (
            SELECT COUNT(*) 
            FROM cartera.cuotas_credito cc 
            WHERE cc.credito_id = c.credito_id 
              AND cc.numero_cuota > 0 
              AND cc.pagado = true
          ) = 0
        ORDER BY c.fecha_creacion DESC`
  );

  return {
    diagnostico: {
      total_creditos_en_bd: Number(totalCreditosResult.rows[0]?.total ?? 0),
      rango_fechas_creditos: rangoFechasResult.rows[0] ?? null,
      creditos_por_mes_ultimos_12: creditosPorMesResult.rows,
      total_pagos_en_bd: Number(totalPagosResult.rows[0]?.total_pagos ?? 0),
      pagos_con_abono_capital: Number(
        totalPagosResult.rows[0]?.con_abono_capital ?? 0
      ),
    },
    auditoria_membresias: {
      descripcion:
        "Créditos nuevos (desde 2026-03-01) con membresias_mes o membresias_pago > 0 pero sin ninguna cuota real pagada",
      total_anomalias: creditosMembresiasSinPagoResult.rows.length,
      creditos: creditosMembresiasSinPagoResult.rows,
    },
    generado_en: new Date().toISOString(),
  };
}


/**
 * Obtiene créditos nuevos (creados desde `fecha_desde`) que tienen al menos
 * un pago con abono de capital registrado.
 * Usa AT TIME ZONE 'America/Guatemala' para comparar fechas correctamente.
 *
 * @param fecha_desde  Fecha de inicio del filtro (formato YYYY-MM-DD). Por defecto 1 de marzo del año actual.
 * @param fecha_hasta  Fecha de fin del filtro (formato YYYY-MM-DD). Por defecto hoy.
 * @param solo_con_abonos Si true (default), solo retorna los que tienen abonos.
 */
export async function getCreditosNuevosConAbonos(
  fecha_desde?: string,
  fecha_hasta?: string,
  solo_con_abonos: boolean = true
): Promise<{
  filtros: { fecha_desde: string; fecha_hasta: string; solo_con_abonos: boolean };
  resumen: {
    total_creditos_nuevos: number;
    creditos_con_abonos: number;
    creditos_sin_abonos: number;
    monto_total_abonado_capital: string;
  };
  creditos: CreditoNuevoConAbono[];
  generado_en: string;
}> {
  const now = new Date();
  const defaultFechaDesde = `${now.getFullYear()}-03-01`;
  const defaultFechaHasta = now.toISOString().split("T")[0];

  const fechaDesde = fecha_desde ?? defaultFechaDesde;
  const fechaHasta = fecha_hasta ?? defaultFechaHasta;

  console.log(
    `[getCreditosNuevosConAbonos] Buscando créditos creados desde ${fechaDesde} hasta ${fechaHasta}`
  );

  // 1. Obtener créditos nuevos en el rango de fechas usando AT TIME ZONE
  //    para evitar problemas con timestamps timezone-aware
  const creditosNuevos = await db
    .select({
      credito_id: creditos.credito_id,
      numero_credito_sifco: creditos.numero_credito_sifco,
      fecha_creacion: creditos.fecha_creacion,
      capital: creditos.capital,
      status_credit: creditos.statusCredit,
      cliente_nombre: usuarios.nombre,
    })
    .from(creditos)
    .innerJoin(usuarios, eq(creditos.usuario_id, usuarios.usuario_id))
    .where(
      and(
        sql`(${creditos.fecha_creacion} AT TIME ZONE 'America/Guatemala')::date >= ${fechaDesde}::date`,
        sql`(${creditos.fecha_creacion} AT TIME ZONE 'America/Guatemala')::date <= ${fechaHasta}::date`
      )
    )
    .orderBy(creditos.fecha_creacion);

  console.log(
    `[getCreditosNuevosConAbonos] Créditos encontrados en rango: ${creditosNuevos.length}`
  );

  // 2. Para cada crédito, traer sus pagos con abono de capital
  const resultados: CreditoNuevoConAbono[] = await Promise.all(
    creditosNuevos.map(async (c) => {
      try {
        const pagosConAbono = await db
          .select({
            pago_id: pagos_credito.pago_id,
            fecha_pago: pagos_credito.fecha_pago,
            monto_boleta: pagos_credito.monto_boleta,
            abono_capital: pagos_credito.abono_capital,
            abono_interes: pagos_credito.abono_interes,
            abono_iva_12: pagos_credito.abono_iva_12,
          })
          .from(pagos_credito)
          .where(
            and(
              eq(pagos_credito.credito_id, c.credito_id),
              sql`CAST(${pagos_credito.abono_capital} AS NUMERIC) > 0`
            )
          );

        const totalPagosResult = await db
          .select({ count: sql<number>`COUNT(*)` })
          .from(pagos_credito)
          .where(eq(pagos_credito.credito_id, c.credito_id));

        const totalPagos = Number(totalPagosResult[0]?.count ?? 0);

        const totalAbonoCapital = pagosConAbono.reduce(
          (sum, p) => sum + parseFloat(p.abono_capital ?? "0"),
          0
        );

        return {
          credito_id: c.credito_id,
          numero_credito_sifco: c.numero_credito_sifco,
          fecha_creacion: c.fecha_creacion,
          cliente_nombre: c.cliente_nombre,
          capital: c.capital,
          status_credit: c.status_credit,
          total_pagos: totalPagos,
          pagos_con_abono: pagosConAbono.length,
          total_abono_capital: totalAbonoCapital.toFixed(2),
          tiene_abonos: pagosConAbono.length > 0,
          detalle_pagos: pagosConAbono.map((p) => ({
            pago_id: p.pago_id,
            fecha_pago: p.fecha_pago,
            monto_boleta: p.monto_boleta,
            abono_capital: p.abono_capital,
            abono_interes: p.abono_interes,
            abono_iva_12: p.abono_iva_12,
          })),
        };
      } catch (err) {
        console.error(
          `[getCreditosNuevosConAbonos] Error consultando pagos de crédito ${c.credito_id}:`,
          err
        );
        return {
          credito_id: c.credito_id,
          numero_credito_sifco: c.numero_credito_sifco,
          fecha_creacion: c.fecha_creacion,
          cliente_nombre: c.cliente_nombre,
          capital: c.capital,
          status_credit: c.status_credit,
          total_pagos: 0,
          pagos_con_abono: 0,
          total_abono_capital: "0.00",
          tiene_abonos: false,
          detalle_pagos: [],
        };
      }
    })
  );

  // 3. Filtrar si solo queremos los que tienen abonos
  const filtrados = solo_con_abonos
    ? resultados.filter((r) => r.tiene_abonos)
    : resultados;

  // 4. Calcular resumen global
  const resumen = {
    total_creditos_nuevos: resultados.length,
    creditos_con_abonos: resultados.filter((r) => r.tiene_abonos).length,
    creditos_sin_abonos: resultados.filter((r) => !r.tiene_abonos).length,
    monto_total_abonado_capital: resultados
      .reduce((sum, r) => sum + parseFloat(r.total_abono_capital), 0)
      .toFixed(2),
  };

  console.log(
    `[getCreditosNuevosConAbonos] Resumen: ${resumen.creditos_con_abonos} con abonos de ${resumen.total_creditos_nuevos} créditos nuevos`
  );

  return {
    filtros: {
      fecha_desde: fechaDesde,
      fecha_hasta: fechaHasta,
      solo_con_abonos,
    },
    resumen,
    creditos: filtrados,
    generado_en: new Date().toISOString(),
  };
}
