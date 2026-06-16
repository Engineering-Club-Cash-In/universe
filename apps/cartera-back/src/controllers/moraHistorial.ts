import { db } from "../database";
import { sql } from "drizzle-orm";
import ExcelJS from "exceljs";

// ─────────────────────────────────────────────────────────────────────────────
// Módulo Mora Histórica: reconstruye la mora a cualquier fecha desde
// `moras_historial` (independiente del cron / de la tabla moras_credito actual,
// que puede estar condonada). Ver controllers/latefee.ts (procesarMoras).
// ─────────────────────────────────────────────────────────────────────────────

// Etapa de mora a partir de cuotas atrasadas (igual criterio que el reporte Pagos x Venc).
const ETAPA_SQL = sql`CASE
  WHEN s.cuotas = 1 THEN 'Mora 30'
  WHEN s.cuotas = 2 THEN 'Mora 60'
  WHEN s.cuotas = 3 THEN 'Mora 90'
  WHEN s.cuotas >= 4 THEN 'Mora 120+'
  ELSE 'Al día' END`;

// CTE: último evento de mora por crédito con fecha <= `fecha` (estado "as-of").
const snapCte = (fecha: string) => sql`
  snap AS (
    SELECT DISTINCT ON (h.credito_id)
      h.credito_id,
      h.tipo_evento,
      h.monto_nuevo::numeric        AS monto,
      h.cuotas_atrasadas_nuevas     AS cuotas,
      h.fecha
    FROM cartera.moras_historial h
    -- Corte por DÍA Guatemala: fecha es timestamp UTC (defaultNow, session UTC) y el cron
    -- corre ~23:59 GT (≈06:00 UTC del día siguiente); comparar en GT evita correr esos
    -- eventos al día siguiente.
    WHERE (h.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala')::date <= ${fecha}::date
    ORDER BY h.credito_id, h.fecha DESC, h.historial_id DESC
  )`;

type SnapshotArgs = {
  fecha: string; // YYYY-MM-DD (corte "al" día)
  asesor?: string; // CSV de nombres
  etapa?: string; // '0-30' | '31-60' | '61-90' | '+90'
  numero_credito_sifco?: string;
  nombre_usuario?: string;
  page?: number;
  pageSize?: number;
};

function buildSnapshotWhere(a: SnapshotArgs) {
  // Solo créditos con mora viva a la fecha (último evento no es desactivación y monto > 0).
  const filters: any[] = [sql`s.tipo_evento <> 'DESACTIVACION'`, sql`s.monto > 0`];
  if (a.etapa === "0-30") filters.push(sql`s.cuotas = 1`);
  else if (a.etapa === "31-60") filters.push(sql`s.cuotas = 2`);
  else if (a.etapa === "61-90") filters.push(sql`s.cuotas = 3`);
  else if (a.etapa === "+90") filters.push(sql`s.cuotas >= 4`);
  if (a.numero_credito_sifco) filters.push(sql`c.numero_credito_sifco ILIKE ${"%" + a.numero_credito_sifco + "%"}`);
  if (a.nombre_usuario) filters.push(sql`u.nombre ILIKE ${"%" + a.nombre_usuario + "%"}`);
  if (a.asesor) {
    const names = a.asesor.split(",").map((n) => n.trim()).filter(Boolean);
    if (names.length) filters.push(sql`(${sql.join(names.map((n) => sql`a.nombre ILIKE ${"%" + n + "%"}`), sql` OR `)})`);
  }
  return sql.join(filters, sql` AND `);
}

const snapFromJoins = sql`
  FROM snap s
  INNER JOIN cartera.creditos c ON c.credito_id = s.credito_id
  INNER JOIN cartera.usuarios u ON u.usuario_id = c.usuario_id
  INNER JOIN cartera.asesores a ON a.asesor_id = c.asesor_id`;

// Snapshot por crédito de la mora a una fecha, con totales y filtros.
export async function getMoraHistorialSnapshot(a: SnapshotArgs) {
  const fecha = a.fecha;
  // Clamp defensivo: evita OFFSET negativo / NaN si llega page/pageSize inválido.
  const page = Number.isFinite(a.page) && (a.page as number) > 0 ? Math.floor(a.page as number) : 1;
  const pageSize = Number.isFinite(a.pageSize) && (a.pageSize as number) > 0 ? Math.min(Math.floor(a.pageSize as number), 500) : 20;
  const offset = (page - 1) * pageSize;
  const where = buildSnapshotWhere(a);

  const [totRes, dataRes] = await Promise.all([
    db.execute<any>(sql`
      WITH ${snapCte(fecha)}
      SELECT
        COUNT(*)::int AS total,
        COALESCE(SUM(s.monto), 0) AS mora_total,
        COALESCE(SUM(CASE WHEN s.cuotas = 1 THEN s.monto ELSE 0 END), 0) AS mora_30,
        COALESCE(SUM(CASE WHEN s.cuotas = 2 THEN s.monto ELSE 0 END), 0) AS mora_60,
        COALESCE(SUM(CASE WHEN s.cuotas = 3 THEN s.monto ELSE 0 END), 0) AS mora_90,
        COALESCE(SUM(CASE WHEN s.cuotas >= 4 THEN s.monto ELSE 0 END), 0) AS mora_120
      ${snapFromJoins}
      WHERE ${where}
    `),
    db.execute<any>(sql`
      WITH ${snapCte(fecha)}
      SELECT
        c.credito_id,
        c.numero_credito_sifco,
        u.nombre AS cliente,
        a.nombre AS asesor,
        c."statusCredit" AS status,
        s.cuotas AS cuotas_atrasadas,
        ${ETAPA_SQL} AS etapa,
        ROUND(s.monto, 2) AS mora,
        ROUND(c.capital::numeric, 2) AS capital,
        s.fecha AS actualizado
      ${snapFromJoins}
      WHERE ${where}
      ORDER BY s.monto DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `),
  ]);

  const tot = totRes.rows[0] ?? {};
  const total = Number(tot.total ?? 0);
  return {
    success: true,
    fecha,
    data: dataRes.rows,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    totales: {
      mora_total: Number(tot.mora_total ?? 0).toFixed(2),
      mora_30: Number(tot.mora_30 ?? 0).toFixed(2),
      mora_60: Number(tot.mora_60 ?? 0).toFixed(2),
      mora_90: Number(tot.mora_90 ?? 0).toFixed(2),
      mora_120: Number(tot.mora_120 ?? 0).toFixed(2),
      creditos: total,
    },
  };
}

// Timeline: total de mora reconstruido as-of para cada día del rango (evolución).
export async function getMoraTimeline({ desde, hasta, asesor }: { desde: string; hasta: string; asesor?: string }) {
  // Filtro de asesor: limita a créditos del/los asesor(es).
  let asesorFilter = sql``;
  if (asesor) {
    const names = asesor.split(",").map((n) => n.trim()).filter(Boolean);
    if (names.length) {
      asesorFilter = sql` AND h.credito_id IN (
        SELECT c.credito_id FROM cartera.creditos c
        INNER JOIN cartera.asesores a ON a.asesor_id = c.asesor_id
        WHERE (${sql.join(names.map((n) => sql`a.nombre ILIKE ${"%" + n + "%"}`), sql` OR `)})
      )`;
    }
  }
  const res = await db.execute<any>(sql`
    SELECT d::date AS fecha, (
      SELECT COALESCE(SUM(s.monto), 0)
      FROM (
        SELECT DISTINCT ON (h.credito_id) h.monto_nuevo::numeric AS monto, h.tipo_evento
        FROM cartera.moras_historial h
        WHERE (h.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala')::date <= d ${asesorFilter}
        ORDER BY h.credito_id, h.fecha DESC, h.historial_id DESC
      ) s
      WHERE s.tipo_evento <> 'DESACTIVACION' AND s.monto > 0
    ) AS mora_total
    FROM generate_series(${desde}::date, ${hasta}::date, INTERVAL '1 day') d
    ORDER BY d
  `);
  return {
    success: true,
    data: res.rows.map((r) => ({ fecha: r.fecha, mora_total: Number(r.mora_total).toFixed(2) })),
  };
}

// Historial de eventos de mora de un crédito (drill-down).
export async function getMoraHistorialCredito({ credito_id }: { credito_id: number }) {
  const res = await db.execute<any>(sql`
    SELECT
      h.historial_id,
      h.fecha,
      h.tipo_evento,
      h.origen,
      ROUND(h.monto_anterior::numeric, 2) AS monto_anterior,
      ROUND(h.monto_nuevo::numeric, 2) AS monto_nuevo,
      h.cuotas_atrasadas_anterior,
      h.cuotas_atrasadas_nuevas,
      h.motivo,
      pu.email AS usuario
    FROM cartera.moras_historial h
    LEFT JOIN cartera.platform_users pu ON pu.id = h.usuario_id
    WHERE h.credito_id = ${credito_id}
    ORDER BY h.fecha DESC, h.historial_id DESC
  `);
  return { success: true, data: res.rows };
}

// Excel del snapshot (todas las filas, sin paginar).
export async function getMoraHistorialExcel(a: SnapshotArgs): Promise<Buffer> {
  const where = buildSnapshotWhere(a);
  const res = await db.execute<any>(sql`
    WITH ${snapCte(a.fecha)}
    SELECT c.numero_credito_sifco, u.nombre AS cliente, a.nombre AS asesor, c."statusCredit" AS status,
      s.cuotas AS cuotas_atrasadas, ${ETAPA_SQL} AS etapa, ROUND(s.monto, 2) AS mora, ROUND(c.capital::numeric, 2) AS capital
    ${snapFromJoins}
    WHERE ${where}
    ORDER BY s.monto DESC
  `);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(`Mora al ${a.fecha}`);
  ws.columns = [
    { header: "No. SIFCO", key: "numero_credito_sifco", width: 18 },
    { header: "Cliente", key: "cliente", width: 32 },
    { header: "Asesor", key: "asesor", width: 24 },
    { header: "Status", key: "status", width: 16 },
    { header: "Cuotas atrasadas", key: "cuotas_atrasadas", width: 16 },
    { header: "Etapa", key: "etapa", width: 12 },
    { header: "Capital", key: "capital", width: 16 },
    { header: "Mora", key: "mora", width: 16 },
  ];
  ws.getRow(1).font = { bold: true };
  let totalMora = 0;
  for (const r of res.rows) { ws.addRow(r); totalMora += Number(r.mora); }
  const totalRow = ws.addRow({ asesor: "TOTAL", mora: Number(totalMora.toFixed(2)) });
  totalRow.font = { bold: true };
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
