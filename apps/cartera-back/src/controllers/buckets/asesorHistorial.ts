import { db } from "../../database";
import { SQL_CARTERA_SCHEMA } from "../../database/db/schema";
import { sql } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// COBROS-02 · Asesores — Bitácora de reasignaciones (append-only).
// Lee `cartera.credito_asesor_historial` (la llena el motor al reasignar y los
// scripts de siembra) con joins al crédito, cliente, ambos asesores y el bucket
// snapshot. Endpoint de solo lectura, paginado y con filtros — espejo de
// bucketsHistorial.ts a propósito (mismo patrón, misma validación en el router).
// ─────────────────────────────────────────────────────────────────────────────

export type AsesorHistorialArgs = {
  desde?: string; // YYYY-MM-DD (corte por día GT, inclusive)
  hasta?: string; // YYYY-MM-DD (corte por día GT, inclusive)
  origen?: string; // PROCESO_AUTO | API_MANUAL
  bucket?: string; // CSV de enteros (snapshot del bucket al momento del cambio)
  asesor_nuevo?: string; // CSV de nombres, ILIKE
  asesor_anterior?: string; // CSV de nombres, ILIKE
  credito_id?: number;
  numero_credito_sifco?: string; // ILIKE
  nombre_usuario?: string; // cliente, ILIKE
  page?: number;
  pageSize?: number;
};

// CSV → lista limpia de strings.
const csv = (v?: string) =>
  (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// CSV → lista de enteros válidos.
const csvInts = (v?: string) =>
  csv(v).map((s) => Number(s)).filter((n) => Number.isInteger(n));

function buildWhere(a: AsesorHistorialArgs) {
  const filters: any[] = [];

  // Rango de fecha por DÍA Guatemala (fecha es timestamp UTC; el motor corre
  // ~23:59 GT ≈ 06:00 UTC del día siguiente → comparar en GT evita el corrimiento).
  const fechaGT = sql`(h.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala')::date`;
  if (a.desde) filters.push(sql`${fechaGT} >= ${a.desde}::date`);
  if (a.hasta) filters.push(sql`${fechaGT} <= ${a.hasta}::date`);

  if (a.origen) filters.push(sql`h.origen = ${a.origen}`);

  const bucketsSnap = csvInts(a.bucket);
  if (bucketsSnap.length) {
    filters.push(sql`h.bucket IN (${sql.join(bucketsSnap.map((n) => sql`${n}`), sql`, `)})`);
  }

  if (a.credito_id) filters.push(sql`h.credito_id = ${a.credito_id}`);
  if (a.numero_credito_sifco) {
    filters.push(sql`c.numero_credito_sifco ILIKE ${"%" + a.numero_credito_sifco + "%"}`);
  }
  if (a.nombre_usuario) filters.push(sql`u.nombre ILIKE ${"%" + a.nombre_usuario + "%"}`);

  const nuevos = csv(a.asesor_nuevo);
  if (nuevos.length) {
    filters.push(
      sql`(${sql.join(nuevos.map((n) => sql`an.nombre ILIKE ${"%" + n + "%"}`), sql` OR `)})`,
    );
  }
  const anteriores = csv(a.asesor_anterior);
  if (anteriores.length) {
    filters.push(
      sql`(${sql.join(anteriores.map((n) => sql`aa.nombre ILIKE ${"%" + n + "%"}`), sql` OR `)})`,
    );
  }

  return filters.length ? sql.join(filters, sql` AND `) : sql`TRUE`;
}

// Joins compartidos entre el conteo y la data.
// - creditos/usuarios: INNER (toda reasignación tiene su crédito y cliente).
// - asesores aa/an: LEFT (asesor_anterior NULL = siembra; nuevo nullable a futuro).
// - buckets b: LEFT contra el catálogo (nombre/prefijo del snapshot).
// - platform_users pu: LEFT, quién hizo el cambio (solo API_MANUAL).
const joins = sql`
  FROM ${SQL_CARTERA_SCHEMA}.credito_asesor_historial h
  INNER JOIN ${SQL_CARTERA_SCHEMA}.creditos c ON c.credito_id = h.credito_id
  INNER JOIN ${SQL_CARTERA_SCHEMA}.usuarios u ON u.usuario_id = c.usuario_id
  LEFT JOIN ${SQL_CARTERA_SCHEMA}.asesores aa ON aa.asesor_id = h.asesor_anterior
  LEFT JOIN ${SQL_CARTERA_SCHEMA}.asesores an ON an.asesor_id = h.asesor_nuevo
  LEFT JOIN ${SQL_CARTERA_SCHEMA}.buckets b ON b.numero = h.bucket
  LEFT JOIN ${SQL_CARTERA_SCHEMA}.platform_users pu ON pu.id = h.usuario_id`;

// Bitácora paginada de cambios de asesor, con filtros, joins y resumen.
export async function getAsesorHistorial(a: AsesorHistorialArgs) {
  // Clamp defensivo: floor PRIMERO y mínimo 1 DESPUÉS (mismo criterio que
  // bucketsHistorial — page=0.5 → floor 0 → OFFSET negativo si no).
  const pageFloor = Math.floor(Number(a.page));
  const page = Number.isFinite(pageFloor) && pageFloor > 0 ? pageFloor : 1;
  const sizeFloor = Math.floor(Number(a.pageSize));
  const pageSize = Number.isFinite(sizeFloor) && sizeFloor > 0 ? Math.min(sizeFloor, 500) : 20;
  const offset = (page - 1) * pageSize;
  const where = buildWhere(a);

  const [totRes, dataRes] = await Promise.all([
    db.execute<any>(sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE h.origen = 'PROCESO_AUTO')::int AS automaticos,
        COUNT(*) FILTER (WHERE h.origen = 'API_MANUAL')::int AS manuales,
        COUNT(DISTINCT h.credito_id)::int AS creditos
      ${joins}
      WHERE ${where}
    `),
    db.execute<any>(sql`
      SELECT
        h.historial_id,
        h.fecha,
        h.credito_id,
        c.numero_credito_sifco,
        u.nombre AS cliente,
        h.asesor_anterior AS asesor_anterior_id,
        aa.nombre AS asesor_anterior,
        h.asesor_nuevo AS asesor_nuevo_id,
        an.nombre AS asesor_nuevo,
        h.bucket,
        b.prefijo AS bucket_prefijo,
        b.nombre  AS bucket_nombre,
        h.origen,
        h.motivo,
        pu.email AS usuario,
        c."statusCredit" AS status_actual
      ${joins}
      WHERE ${where}
      ORDER BY h.fecha DESC, h.historial_id DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `),
  ]);

  const tot = totRes.rows[0] ?? {};
  const total = Number(tot.total ?? 0);
  return {
    success: true,
    data: dataRes.rows,
    pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) },
    resumen: {
      total,
      automaticos: Number(tot.automaticos ?? 0),
      manuales: Number(tot.manuales ?? 0),
      creditos: Number(tot.creditos ?? 0),
    },
  };
}
