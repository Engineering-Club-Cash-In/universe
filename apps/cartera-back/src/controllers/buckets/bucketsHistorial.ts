import { db } from "../../database";
import { sql } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// COBROS-02 · Buckets — Histórico de transiciones (append-only).
// Lee `cartera.buckets_historial` (lo llena el motor en procesarMoras) con joins
// al crédito y al catálogo `cartera.buckets`. Endpoint de solo lectura, paginado
// y con filtros. Separado del resto (carpeta controllers/buckets/) a propósito.
// Ver: controllers/latefee.ts (motor) y drizzle/cobros-02/ (migraciones).
// ─────────────────────────────────────────────────────────────────────────────

export type BucketsHistorialArgs = {
  desde?: string; // YYYY-MM-DD (corte por día GT, inclusive)
  hasta?: string; // YYYY-MM-DD (corte por día GT, inclusive)
  tipo_evento?: string; // CSV: INICIAL,SUBIDA,BAJADA
  origen?: string; // PROCESO_AUTO | API_MANUAL
  bucket_nuevo?: string; // CSV de enteros 0-5
  bucket_anterior?: string; // CSV de enteros 0-5
  credito_id?: number;
  numero_credito_sifco?: string; // ILIKE
  nombre_usuario?: string; // cliente, ILIKE
  asesor?: string; // CSV de nombres (asesor del crédito), ILIKE
  status_credito?: string; // status snapshot del evento (ILIKE)
  pago_id?: number;
  page?: number;
  pageSize?: number;
};

// CSV → lista limpia de strings.
const csv = (v?: string) =>
  (v ?? "").split(",").map((s) => s.trim()).filter(Boolean);

// CSV → lista de enteros válidos.
const csvInts = (v?: string) =>
  csv(v).map((s) => Number(s)).filter((n) => Number.isInteger(n));

function buildWhere(a: BucketsHistorialArgs) {
  const filters: any[] = [];

  // Rango de fecha por DÍA Guatemala (fecha es timestamp UTC; el motor corre
  // ~23:59 GT ≈ 06:00 UTC del día siguiente → comparar en GT evita el corrimiento).
  const fechaGT = sql`(h.fecha AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala')::date`;
  if (a.desde) filters.push(sql`${fechaGT} >= ${a.desde}::date`);
  if (a.hasta) filters.push(sql`${fechaGT} <= ${a.hasta}::date`);

  const tipos = csv(a.tipo_evento);
  if (tipos.length) {
    filters.push(sql`h.tipo_evento IN (${sql.join(tipos.map((t) => sql`${t}`), sql`, `)})`);
  }
  if (a.origen) filters.push(sql`h.origen = ${a.origen}`);

  const bNuevo = csvInts(a.bucket_nuevo);
  if (bNuevo.length) {
    filters.push(sql`h.bucket_nuevo IN (${sql.join(bNuevo.map((n) => sql`${n}`), sql`, `)})`);
  }
  const bAnterior = csvInts(a.bucket_anterior);
  if (bAnterior.length) {
    filters.push(sql`h.bucket_anterior IN (${sql.join(bAnterior.map((n) => sql`${n}`), sql`, `)})`);
  }

  if (a.credito_id) filters.push(sql`h.credito_id = ${a.credito_id}`);
  if (a.pago_id) filters.push(sql`h.pago_id = ${a.pago_id}`);
  if (a.numero_credito_sifco) {
    filters.push(sql`c.numero_credito_sifco ILIKE ${"%" + a.numero_credito_sifco + "%"}`);
  }
  if (a.nombre_usuario) filters.push(sql`u.nombre ILIKE ${"%" + a.nombre_usuario + "%"}`);
  if (a.status_credito) filters.push(sql`h.status_credito ILIKE ${"%" + a.status_credito + "%"}`);

  const asesores = csv(a.asesor);
  if (asesores.length) {
    filters.push(
      sql`(${sql.join(asesores.map((n) => sql`a.nombre ILIKE ${"%" + n + "%"}`), sql` OR `)})`,
    );
  }

  return filters.length ? sql.join(filters, sql` AND `) : sql`TRUE`;
}

// Joins compartidos entre el conteo y la data.
// - creditos/usuarios: INNER (todo evento tiene su crédito y cliente).
// - asesor del crédito: LEFT (algunos créditos pueden no tener asesor asignado).
// - buckets bn/ba: LEFT contra el catálogo (nombre/prefijo); ba puede ser null.
// - asesores aa: LEFT, asesor de ATRIBUCIÓN del evento (h.asesor_id, la BAJADA curada).
const joins = sql`
  FROM cartera.buckets_historial h
  INNER JOIN cartera.creditos c ON c.credito_id = h.credito_id
  INNER JOIN cartera.usuarios u ON u.usuario_id = c.usuario_id
  LEFT JOIN cartera.asesores a ON a.asesor_id = c.asesor_id
  LEFT JOIN cartera.buckets bn ON bn.numero = h.bucket_nuevo
  LEFT JOIN cartera.buckets ba ON ba.numero = h.bucket_anterior
  LEFT JOIN cartera.asesores aa ON aa.asesor_id = h.asesor_id`;

// Histórico paginado de transiciones de bucket, con filtros, joins y resumen.
export async function getBucketsHistorial(a: BucketsHistorialArgs) {
  // Clamp defensivo: floor PRIMERO y mínimo 1 DESPUÉS (review Codex). Chequear
  // >0 antes del floor dejaba pasar fraccionales: page=0.5 → floor 0 → OFFSET
  // negativo (500 de PG); pageSize=0.5 → floor 0 → LIMIT 0 + totalPages Infinity.
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
        COUNT(*) FILTER (WHERE h.tipo_evento = 'INICIAL')::int AS iniciales,
        COUNT(*) FILTER (WHERE h.tipo_evento = 'SUBIDA')::int AS subidas,
        COUNT(*) FILTER (WHERE h.tipo_evento = 'BAJADA')::int AS bajadas
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
        c.asesor_id,
        a.nombre AS asesor,
        h.tipo_evento,
        h.origen,
        h.bucket_anterior,
        ba.prefijo AS bucket_anterior_prefijo,
        ba.nombre  AS bucket_anterior_nombre,
        h.bucket_nuevo,
        bn.prefijo AS bucket_nuevo_prefijo,
        bn.nombre  AS bucket_nuevo_nombre,
        h.cuotas_atrasadas_nuevas,
        h.status_credito,
        c."statusCredit" AS status_actual,
        ROUND(c.capital::numeric, 2) AS capital,
        h.asesor_id AS asesor_atribucion_id,
        aa.nombre AS asesor_atribucion,
        h.pago_id,
        h.motivo
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
      iniciales: Number(tot.iniciales ?? 0),
      subidas: Number(tot.subidas ?? 0),
      bajadas: Number(tot.bajadas ?? 0),
    },
  };
}

// Drill-down: historial completo de transiciones de bucket de un crédito.
export async function getBucketsHistorialCredito({ credito_id }: { credito_id: number }) {
  const res = await db.execute<any>(sql`
    SELECT
      h.historial_id,
      h.fecha,
      h.tipo_evento,
      h.origen,
      h.bucket_anterior,
      ba.prefijo AS bucket_anterior_prefijo,
      ba.nombre  AS bucket_anterior_nombre,
      h.bucket_nuevo,
      bn.prefijo AS bucket_nuevo_prefijo,
      bn.nombre  AS bucket_nuevo_nombre,
      h.cuotas_atrasadas_nuevas,
      h.status_credito,
      h.asesor_id AS asesor_atribucion_id,
      aa.nombre AS asesor_atribucion,
      h.pago_id,
      h.motivo
    FROM cartera.buckets_historial h
    LEFT JOIN cartera.buckets bn ON bn.numero = h.bucket_nuevo
    LEFT JOIN cartera.buckets ba ON ba.numero = h.bucket_anterior
    LEFT JOIN cartera.asesores aa ON aa.asesor_id = h.asesor_id
    WHERE h.credito_id = ${credito_id}
    ORDER BY h.fecha DESC, h.historial_id DESC
  `);
  return { success: true, data: res.rows };
}
