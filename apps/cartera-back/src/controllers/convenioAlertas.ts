import { db } from "../database";
import { SQL_CARTERA_SCHEMA } from "../database/db/schema";
import { sql } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// COBROS-02 · Fase 1 — ALERTAS DE CONVENIOS (una fila por CONVENIO, no por cuota).
//
// Responde "¿qué convenios requieren acción HOY?" para dos consumidores:
//   · el job `check-convenios-incumplidos` del CRM (categoría `vencida` →
//     notifica al asesor y al supervisor);
//   · la pantalla `/cobros/alertas-convenios`, calcada de Alertas de Promesas.
//
// Una fila por convenio y no por cuota a propósito: el asesor gestiona la
// CUENTA, no cada cuota suelta. La fila trae la cuota más urgente impaga y, si
// hay varias vencidas, cuántas son y cuánto suman.
//
// ── Qué cuenta como "cuota del convenio" ────────────────────────────────────
// Exactamente el mismo modelo que `bucketsConvenio.ts`, y esto NO es opcional:
//   · Se ignoran las cuotas que NACIERON vencidas (fecha_venc <= fecha_convenio).
//     Son la deuda vieja que el acuerdo regularizó — heredan las fechas de las
//     cuotas viejas del crédito, así que sin este corte todo convenio nuevo
//     aparecería incumplido el día que se firma.
//   · Sobre las de ADELANTE se re-indexa: la j-ésima está CUBIERTA si
//     `monto_pagado >= j * cuota_mensual`. Los pagos se acreditan de adelante
//     hacia atrás y los parciales acumulativos (Q60+Q40) no marcan `fecha_pago`,
//     así que la cobertura se mide por MONTO, no por esa columna.
//
// `monto_cuota` = lo que el cliente debe ese día = cuota normal del crédito
// (si sigue impaga) + lo que resta de la cuota del convenio, igual que
// `convenioProximos.ts`: en convenio se pagan las dos.
// ─────────────────────────────────────────────────────────────────────────────

export type ConvenioAlertaCategoria =
  | "vencida"
  | "vence_hoy"
  | "por_vencer"
  | "proxima";

export interface ConvenioAlertasOpciones {
  /** Ventana hacia atrás para las vencidas (días). Cota de volumen, no de negocio. */
  diasAtras?: number;
  /** Hasta cuántos días adelante se listan las próximas. */
  diasAdelante?: number;
  /** Frontera `por_vencer` / `proxima`: dentro de estos días ya requiere acción. */
  diasAlerta?: number;
  /** Filtra por el asesor DUEÑO del crédito. */
  asesorId?: number;
  /** Filtra a UN crédito — lo usa la banda de la Ficha 360. */
  numeroSifco?: string;
}

const DEFAULTS = {
  diasAtras: 365,
  diasAdelante: 31,
  diasAlerta: 5,
} as const;

export async function getConvenioAlertas(opts: ConvenioAlertasOpciones = {}) {
  const diasAtras = opts.diasAtras ?? DEFAULTS.diasAtras;
  const diasAdelante = opts.diasAdelante ?? DEFAULTS.diasAdelante;
  const diasAlerta = opts.diasAlerta ?? DEFAULTS.diasAlerta;

  // Los días se castean a `::int` en cada `fecha ± días`. node-postgres manda
  // los parámetros sin tipo, y `date + $1` es ambiguo para Postgres (date +
  // integer, + interval o + time): la consulta entera fallaba con "operator is
  // not unique: date + unknown" — para cualquier crédito, así que la banda
  // roja, la pantalla de alertas y el job de las 8:00 nunca respondieron.
  // Las pruebas no lo veían porque mockean la DB.
  const hoyGT = sql`(now() AT TIME ZONE 'America/Guatemala')::date`;
  const filtroAsesor =
    opts.asesorId != null ? sql`AND c.asesor_id = ${opts.asesorId}` : sql``;
  const filtroSifco = opts.numeroSifco
    ? sql`AND c.numero_credito_sifco = ${opts.numeroSifco}`
    : sql``;

  const res = await db.execute<any>(sql`
    WITH adelante AS (
      -- Cuotas del convenio posteriores al acuerdo, con su ordinal re-indexado
      -- (incluye las ya pagadas: el ordinal es la POSICIÓN, no el pendiente).
      SELECT
        cc.cuota_convenio_id,
        cc.convenio_id,
        cc.numero_cuota,
        cc.fecha_vencimiento::date AS fecha_vencimiento,
        cp.credito_id,
        cp.cuota_mensual::numeric AS cuota_mensual,
        cp.monto_pagado::numeric  AS monto_pagado,
        ROW_NUMBER() OVER (
          PARTITION BY cc.convenio_id ORDER BY cc.numero_cuota
        ) AS j
      FROM ${SQL_CARTERA_SCHEMA}.convenio_cuotas cc
      INNER JOIN ${SQL_CARTERA_SCHEMA}.convenios_pago cp
        ON cp.convenio_id = cc.convenio_id
       AND cp.activo = true
       AND cp.completado = false
      WHERE cc.fecha_vencimiento::date > cp.fecha_convenio::date
    ),
    pendientes AS (
      -- Impagas de verdad: lo que resta de la j-ésima cuota, medido por monto.
      SELECT
        a.*,
        LEAST(
          a.cuota_mensual,
          GREATEST(0, a.j * a.cuota_mensual - a.monto_pagado)
        ) AS restante
      FROM adelante a
      WHERE a.monto_pagado < a.j * a.cuota_mensual
    ),
    resumen AS (
      SELECT
        p.convenio_id,
        p.credito_id,
        MIN(p.fecha_vencimiento) AS fecha_urgente,
        COUNT(*) FILTER (WHERE p.fecha_vencimiento < ${hoyGT})::int AS cuotas_vencidas,
        COALESCE(SUM(p.restante) FILTER (WHERE p.fecha_vencimiento < ${hoyGT}), 0) AS monto_vencido,
        COUNT(*)::int AS cuotas_pendientes
      FROM pendientes p
      GROUP BY p.convenio_id, p.credito_id
    )
    SELECT
      r.convenio_id,
      r.credito_id,
      c.numero_credito_sifco,
      c."statusCredit" AS status_credit,
      u.nombre AS cliente,
      c.asesor_id,
      a.nombre AS asesor,
      r.fecha_urgente::text AS fecha_vencimiento,
      (r.fecha_urgente - ${hoyGT})::int AS dias_para_vencer,
      r.cuotas_vencidas,
      r.cuotas_pendientes,
      ROUND(r.monto_vencido, 2)::text AS monto_vencido,
      ROUND(cp.monto_pendiente::numeric, 2)::text AS monto_pendiente_convenio,
      ROUND(cp.cuota_mensual::numeric, 2)::text AS cuota_convenio,
      cp.fecha_convenio::date::text AS fecha_convenio,
      -- Bucket MOTOR (última fila de buckets_historial del job de convenios).
      (SELECT h.bucket_nuevo FROM ${SQL_CARTERA_SCHEMA}.buckets_historial h
        WHERE h.credito_id = c.credito_id
        ORDER BY h.fecha DESC, h.historial_id DESC
        LIMIT 1) AS bucket,
      -- Lo que debe pagar el día de la cuota urgente: convenio + cuota normal
      -- del crédito de esa misma fecha si sigue impaga (mismo criterio que
      -- convenioProximos.ts — en convenio se pagan las dos).
      ROUND((
        LEAST(cp.cuota_mensual::numeric,
              GREATEST(0, cur.j * cp.cuota_mensual::numeric - cp.monto_pagado::numeric))
        + COALESCE(norm.monto, 0)
      ), 2)::text AS monto_cuota,
      CASE
        WHEN r.fecha_urgente <  ${hoyGT} THEN 'vencida'
        WHEN r.fecha_urgente =  ${hoyGT} THEN 'vence_hoy'
        WHEN r.fecha_urgente <= ${hoyGT} + ${diasAlerta}::int THEN 'por_vencer'
        ELSE 'proxima'
      END AS categoria
    FROM resumen r
    INNER JOIN ${SQL_CARTERA_SCHEMA}.convenios_pago cp ON cp.convenio_id = r.convenio_id
    INNER JOIN ${SQL_CARTERA_SCHEMA}.creditos c ON c.credito_id = r.credito_id
    INNER JOIN ${SQL_CARTERA_SCHEMA}.usuarios u ON u.usuario_id = c.usuario_id
    LEFT JOIN ${SQL_CARTERA_SCHEMA}.asesores a ON a.asesor_id = c.asesor_id
    -- La cuota urgente en sí (para su ordinal j y su monto restante).
    INNER JOIN LATERAL (
      SELECT p.j
      FROM pendientes p
      WHERE p.convenio_id = r.convenio_id AND p.fecha_vencimiento = r.fecha_urgente
      ORDER BY p.numero_cuota
      LIMIT 1
    ) cur ON true
    -- Cuota normal del crédito que vence el MISMO día, solo si sigue impaga y
    -- no fue absorbida por el convenio (si no, sería doble cobro).
    LEFT JOIN LATERAL (
      SELECT CASE
        WHEN cu.pagado = false
          AND NOT EXISTS (
            SELECT 1 FROM ${SQL_CARTERA_SCHEMA}.pagos_credito pc
             WHERE pc.cuota_id = cu.cuota_id AND pc."paymentFalse" = false
               AND pc.pagado = true AND pc.validation_status IN ('validated', 'no_required')
               AND COALESCE(pc.monto_aplicado, 0) > 0)
          -- Ya hay un pago REGISTRADO aunque CONTA no lo haya validado todavía:
          -- no pedirle plata a quien ya mandó su boleta. Mismo predicado que
          -- cuotasProximas.ts y convenioProximos.ts — sin él, esta pantalla le
          -- decía al asesor que cobrara algo que el cliente ya depositó.
          AND NOT EXISTS (
            SELECT 1 FROM ${SQL_CARTERA_SCHEMA}.pagos_credito pr
             WHERE pr.cuota_id = cu.cuota_id AND pr."paymentFalse" = false
               AND pr.validation_status = 'pending'
               AND COALESCE(pr.monto_boleta, 0) > 0)
        THEN c.cuota ELSE 0 END AS monto
      FROM ${SQL_CARTERA_SCHEMA}.cuotas_credito cu
      WHERE cu.credito_id = c.credito_id
        AND cu.fecha_vencimiento::date = r.fecha_urgente
        AND NOT (cu.cuota_id = ANY(COALESCE(cp.cuotas_convenio, '{}'::int[])))
      ORDER BY cu.cuota_id
      LIMIT 1
    ) norm ON true
    WHERE c."statusCredit" = 'EN_CONVENIO'
      AND r.fecha_urgente >= ${hoyGT} - ${diasAtras}::int
      AND r.fecha_urgente <= ${hoyGT} + ${diasAdelante}::int
      ${filtroAsesor}
      ${filtroSifco}
    ORDER BY r.fecha_urgente ASC, u.nombre ASC
  `);

  const rows = res.rows as Array<Record<string, unknown>>;
  return { success: true, total: rows.length, data: rows };
}
