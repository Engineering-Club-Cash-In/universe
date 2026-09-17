import { sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { db } from "../database";
import { buildReporteCashInWorkbook, sanitizarSheetName } from "../utils/functions/excelCashInReport";
import { clampPagination, contienePatron } from "../utils/functions/pagination";
import { snapCte } from "./moraSnapshotSql";

export { snapCte } from "./moraSnapshotSql";

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
  // `contienePatron` escapa % _ \ del término: son comodines de ILIKE y sin
  // escapar, buscar "_" matchea a TODOS.
  if (a.numero_credito_sifco) filters.push(sql`c.numero_credito_sifco ILIKE ${contienePatron(a.numero_credito_sifco)}`);
  if (a.nombre_usuario) filters.push(sql`u.nombre ILIKE ${contienePatron(a.nombre_usuario)}`);
  if (a.asesor) {
    const names = a.asesor.split(",").map((n) => n.trim()).filter(Boolean);
    if (names.length) filters.push(sql`(${sql.join(names.map((n) => sql`a.nombre ILIKE ${contienePatron(n)}`), sql` OR `)})`);
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
  // Clamp defensivo compartido con los listados de latefee.ts.
  const { page, pageSize, offset } = clampPagination(a.page, a.pageSize);
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
// Respeta el filtro de etapa (Mora 30/60/90/120+) para poder comparar la curva por bucket.
export async function getMoraTimeline({ desde, hasta, asesor, etapa }: { desde: string; hasta: string; asesor?: string; etapa?: string }) {
  // Filtro de asesor: limita a créditos del/los asesor(es).
  let asesorFilter = sql``;
  if (asesor) {
    const names = asesor.split(",").map((n) => n.trim()).filter(Boolean);
    if (names.length) {
      asesorFilter = sql` AND h.credito_id IN (
        SELECT c.credito_id FROM cartera.creditos c
        INNER JOIN cartera.asesores a ON a.asesor_id = c.asesor_id
        WHERE (${sql.join(names.map((n) => sql`a.nombre ILIKE ${contienePatron(n)}`), sql` OR `)})
      )`;
    }
  }
  // Filtro de etapa sobre las cuotas "vivas" (carry-forward) de cada crédito a esa fecha.
  let etapaFilter = sql``;
  if (etapa === "0-30") etapaFilter = sql` AND s.cuotas = 1`;
  else if (etapa === "31-60") etapaFilter = sql` AND s.cuotas = 2`;
  else if (etapa === "61-90") etapaFilter = sql` AND s.cuotas = 3`;
  else if (etapa === "+90") etapaFilter = sql` AND s.cuotas >= 4`;

  const res = await db.execute<any>(sql`
    SELECT d::date AS fecha, (
      SELECT COALESCE(SUM(s.monto), 0)
      FROM (
        -- estado as-of por crédito: monto/tipo del último evento, cuotas con carry-forward
        -- (último evento con cuotas>0) para clasificar la etapa igual que el snapshot.
        SELECT credito_id, monto, tipo_evento, cuotas,
          ROW_NUMBER() OVER (PARTITION BY credito_id ORDER BY fecha DESC, historial_id DESC) AS rn
        FROM (
          SELECT h.credito_id, h.monto_nuevo::numeric AS monto, h.tipo_evento, h.fecha, h.historial_id,
            FIRST_VALUE(h.cuotas_atrasadas_nuevas) OVER (
              PARTITION BY h.credito_id
              ORDER BY (h.cuotas_atrasadas_nuevas > 0) DESC, h.fecha DESC, h.historial_id DESC
            ) AS cuotas
          FROM cartera.moras_historial h
          WHERE (h.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala')::date <= d ${asesorFilter}
        ) hh
      ) s
      WHERE s.rn = 1 AND s.tipo_evento <> 'DESACTIVACION' AND s.monto > 0 ${etapaFilter}
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

// Cabecera del crédito para titular el Excel del drill-down (número SIFCO y
// cliente). Va aparte para poder lanzarla en paralelo con el historial.
// `async` a propósito: dentro del Promise.all, si `db.execute` llegara a tirar
// de forma síncrona, sin async la promesa hermana queda sin handler y se
// convierte en una unhandled rejection del proceso en vez de un 500 limpio.
async function datosDelCredito(credito_id: number) {
  return db.execute<any>(sql`
    SELECT c.numero_credito_sifco, u.nombre AS cliente
    FROM cartera.creditos c
    INNER JOIN cartera.usuarios u ON u.usuario_id = c.usuario_id
    WHERE c.credito_id = ${credito_id}
    LIMIT 1
  `);
}

// Excel del historial de mora de un crédito (drill-down), mismo conjunto de filas
// que getMoraHistorialCredito.
export async function getMoraHistorialCreditoExcel({ credito_id }: { credito_id: number }): Promise<Buffer> {
  // Mismas filas que el JSON: se reusa la función en vez de repetir el SELECT
  // (eran dos copias palabra por palabra). Las dos consultas no dependen entre
  // sí, así que van en paralelo.
  const [historial, credRes] = await Promise.all([
    getMoraHistorialCredito({ credito_id }),
    datosDelCredito(credito_id),
  ]);
  const cred = credRes.rows[0] ?? {};
  const numeroSifco = cred.numero_credito_sifco ?? credito_id;
  const cliente = cred.cliente ?? "";

  // Mismo lenguaje visual que el Excel de inversionistas (helper compartido).
  return buildReporteCashInWorkbook({
    sheetName: `Historial ${numeroSifco}`,
    titulo: `Historial de mora del crédito ${numeroSifco}`,
    subtitulo: cliente ? String(cliente) : undefined,
    filas: historial.data,
    columnas: [
      { header: "Historial ID", key: "historial_id", width: 14, type: "number" },
      { header: "Fecha (GT)", key: "fecha", width: 20, type: "datetime" },
      { header: "Evento", key: "tipo_evento", width: 18 },
      { header: "Origen", key: "origen", width: 16 },
      { header: "Monto anterior", key: "monto_anterior", width: 16, type: "money" },
      { header: "Monto nuevo", key: "monto_nuevo", width: 16, type: "money" },
      { header: "Cuotas atrasadas antes", key: "cuotas_atrasadas_anterior", width: 20, type: "number" },
      { header: "Cuotas atrasadas después", key: "cuotas_atrasadas_nuevas", width: 22, type: "number" },
      { header: "Motivo", key: "motivo", width: 32 },
      { header: "Usuario", key: "usuario", width: 26 },
    ],
  });
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
  // `a.fecha` llega del query string: sin sanitizar, un "/" tumba addWorksheet.
  const ws = wb.addWorksheet(sanitizarSheetName(`Mora al ${a.fecha}`));
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
