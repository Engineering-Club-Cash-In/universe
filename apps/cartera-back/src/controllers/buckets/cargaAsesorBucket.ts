import { sql } from "drizzle-orm";
import { db } from "../../database";
import { SQL_CARTERA_SCHEMA } from "../../database/db/schema";
import { bucketActualSql, STATUS_BUCKET_FUERA } from "../../lib/buckets-classification";

// ─────────────────────────────────────────────────────────────────────────────
// CB-018 · Buckets — Carga de cuentas por asesor y bucket (dashboard gerencial).
// Cuenta, por asesor y por bucket ACTUAL (bucketActualSql, lib/buckets-
// classification.ts: COALESCE(último buckets_historial → estado que fuerza
// bucket → rango de cuotas) — misma fuente que reasignarAsesor.ts usa para no
// divergir), cuántas cuentas del funnel operativo lleva HOY (creditos.asesor_id,
// decisión de raíz schema.ts:539-567).
// Se cruza contra el pool (asesor_bucket) para marcar elegibilidad y contra
// asesor_bucket.capacidad_base (default 300, migración 0004) para % de
// utilización. Mismo par de tablas que ya usa el motor (latefee.ts:1072-1102)
// para calcular "carga" en memoria — aquí se expone como query consultable.
//
// ⚠️ El techo de 300 es POR ASESOR dentro de un bucket, NO agregado del bucket
// completo (confirmado con el informador del ticket: "es la cantidad que
// puede atender un asesor, no necesariamente el bucket tiene el límite").
// Por eso capacidad_base vive en `asesor_bucket` (1 fila por asesor+bucket) y
// sobrecarga/utilización/alerta se calculan por esa misma combinación, nunca
// agregadas a nivel bucket completo.
//
// ⚠️ capacidad_base/margen_alerta_* son SOLO LECTURA aquí: este módulo nunca
// debe escribirlas, y tampoco lo hacen latefee.ts (job automático) ni
// reasignarAsesor.ts (reasignación manual) — ambos solo LEEN asesor_bucket
// para el pool. CB-019 agregó el único camino de escritura explícito, desde
// el CRM: actualizarAsesorBucket.ts (PATCH /buckets/asesor-bucket/:id/:bucket).
// Si algún día se agrega auto-ajuste, que sea una decisión explícita nueva
// en ese módulo, no un efecto colateral acá.
//
// ⚠️ `sobrecarga` (cuentas > capacidad_base) y `alerta_nueva_posicion`
// (cuentas >= capacidad_base + margen, INCLUSIVE — review Codex #1113: con
// capacidad=100/margen=10%, el umbral es 110 y 110 exacto YA debe disparar,
// no solo 111+) son señales DISTINTAS y ambas a nivel asesor+bucket:
// sobrecarga = ya pasó su cupo nominal; alerta = ya amerita abrir nueva
// posición (dispara más tarde, con el margen encima — confirmado con el
// informador: "límite 100, alerta a los 110").
// ─────────────────────────────────────────────────────────────────────────────

export type CargaBucketFila = {
  asesor_id: number;
  nombre: string;
  email_asesor: string | null;
  bucket: number;
  cuentas: number;
};

type BucketCatalogoRow = {
  numero: number;
  prefijo: string;
  nombre: string;
  color: string | null;
};

type MargenAlertaTipo = "porcentaje" | "fijo";

type PoolRow = {
  asesor_id: number;
  bucket: number;
  capacidad_base: number;
  margen_alerta_tipo: MargenAlertaTipo;
  margen_alerta_valor: number;
};

// Deben reflejar los DEFAULT de asesor_bucket (migraciones 0004/0005). Solo se
// usan como fallback para asesores con cuentas en un bucket donde NO tienen
// fila en el pool (fuera de pool) — con NOT NULL DEFAULT no debería faltar en
// el caso normal (asesor sí está en el pool).
const CAPACIDAD_BASE_DEFAULT = 300;
const MARGEN_ALERTA_TIPO_DEFAULT: MargenAlertaTipo = "porcentaje";
const MARGEN_ALERTA_VALOR_DEFAULT = 10;

/**
 * Margen (en cuentas) sobre capacidad_base antes de disparar
 * alerta_nueva_posicion. 'porcentaje' → valor% de capacidad_base;
 * 'fijo' → valor directo en cuentas. Pura, testeable aislada.
 */
export function resolverMargen(
  capacidad: number,
  tipo: MargenAlertaTipo,
  valor: number,
): number {
  return tipo === "fijo" ? valor : capacidad * (valor / 100);
}

export type CargaPorAsesorBucketDetalle = {
  bucket: number;
  cuentas: number;
  capacidad_base: number;
  utilizacion_pct: number;
  elegible: boolean;
  sobrecarga: boolean;
  alerta_nueva_posicion: boolean;
  // Umbral absoluto de cuentas (capacidad_base + margen resuelto) a partir del
  // cual esta fila entra en alerta_nueva_posicion — el frontend lo consume
  // directo, sin recalcular la fórmula del margen (que puede ser % o fijo).
  umbral_alerta_cuentas: number;
  // CB-019: crudos de margen (además del umbral ya resuelto arriba) — el CRM
  // los necesita para prellenar el formulario de edición de capacidad.
  margen_alerta_tipo: MargenAlertaTipo;
  margen_alerta_valor: number;
};

export type CargaPorAsesor = {
  asesor_id: number;
  nombre: string;
  email_asesor: string | null;
  porBucket: CargaPorAsesorBucketDetalle[];
};

export type CargaPorBucketResumen = {
  numero: number;
  prefijo: string;
  nombre: string;
  color: string | null;
  cuentas_totales: number;
  asesores_en_pool: number;
  asesores_en_alerta: number;
  asesores_sobrecargados: number;
};

export type CargaPorAsesorBucketResultado = {
  buckets: CargaPorBucketResumen[];
  porAsesor: CargaPorAsesor[];
  fecha: string;
};

function hoyGTStr(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });
}

/**
 * Créditos activos del funnel operativo, agrupados por dueño actual
 * (creditos.asesor_id) y bucket ACTUAL (motor: buckets_historial, con el mismo
 * fallback que bucketActualDeCredito para créditos aún sin INICIAL).
 */
async function getCuentasPorAsesorYBucket(params: {
  bucket?: number;
  asesor_id?: number;
}): Promise<CargaBucketFila[]> {
  const fueraSql = sql.join(STATUS_BUCKET_FUERA.map((s) => sql`${s}`), sql`, `);
  const bucketFilter =
    params.bucket !== undefined ? sql`AND bucket_actual.bucket = ${params.bucket}` : sql``;
  const asesorFilter =
    params.asesor_id !== undefined ? sql`AND a.asesor_id = ${params.asesor_id}` : sql``;

  const res = await db.execute<{
    asesor_id: number;
    nombre: string;
    email_asesor: string | null;
    bucket: number;
    cuentas: string;
  }>(sql`
    WITH bucket_actual AS (
      SELECT
        c.credito_id,
        ${bucketActualSql("c", "m")} AS bucket
      FROM ${SQL_CARTERA_SCHEMA}.creditos c
      LEFT JOIN ${SQL_CARTERA_SCHEMA}.moras_credito m
        ON m.credito_id = c.credito_id AND m.activa = true
      WHERE c."statusCredit" NOT IN (${fueraSql})
    )
    SELECT
      a.asesor_id, a.nombre, a.email_cash_in AS email_asesor,
      bucket_actual.bucket AS bucket,
      COUNT(*)::int AS cuentas
    FROM bucket_actual
    INNER JOIN ${SQL_CARTERA_SCHEMA}.creditos c ON c.credito_id = bucket_actual.credito_id
    INNER JOIN ${SQL_CARTERA_SCHEMA}.asesores a ON a.asesor_id = c.asesor_id
    WHERE bucket_actual.bucket IS NOT NULL
      ${bucketFilter}
      ${asesorFilter}
    GROUP BY a.asesor_id, a.nombre, a.email_cash_in, bucket_actual.bucket
  `);

  return res.rows.map((r) => ({
    asesor_id: r.asesor_id,
    nombre: r.nombre,
    email_asesor: r.email_asesor,
    bucket: Number(r.bucket),
    cuentas: Number(r.cuentas),
  }));
}

async function getCatalogoBuckets(): Promise<BucketCatalogoRow[]> {
  const res = await db.execute<BucketCatalogoRow>(sql`
    SELECT numero, prefijo, nombre, color
    FROM ${SQL_CARTERA_SCHEMA}.buckets
    WHERE activo = true
    ORDER BY numero
  `);
  return res.rows;
}

/**
 * Pool de asesor_bucket. Acepta los mismos filtros `bucket`/`asesor_id` que
 * getCuentasPorAsesorYBucket para que `asesores_en_pool`/`elegible` en la
 * respuesta queden consistentes con `cuentas_totales`/`asesores_en_alerta`/
 * `asesores_sobrecargados` cuando se filtra — antes ignoraba `bucket` (traía
 * TODOS los buckets aunque el caller pidiera uno solo): inofensivo hoy porque
 * el resto del pipeline solo lee las claves (bucket,asesor) que aparecen en
 * `cuentas` (que sí filtra), pero era una trampa para un futuro uso directo
 * de esta función fuera de getCargaPorAsesorBucket.
 */
async function getPoolPorBucket(params: { bucket?: number; asesor_id?: number }): Promise<PoolRow[]> {
  const bucketFilter =
    params.bucket !== undefined ? sql`AND bucket = ${params.bucket}` : sql``;
  const asesorFilter =
    params.asesor_id !== undefined ? sql`AND asesor_id = ${params.asesor_id}` : sql``;
  const res = await db.execute<{
    asesor_id: number;
    bucket: number;
    capacidad_base: number;
    margen_alerta_tipo: string;
    margen_alerta_valor: string;
  }>(sql`
    SELECT asesor_id, bucket, capacidad_base, margen_alerta_tipo, margen_alerta_valor
    FROM ${SQL_CARTERA_SCHEMA}.asesor_bucket
    WHERE activo = true
      ${bucketFilter}
      ${asesorFilter}
  `);
  return res.rows.map((r) => ({
    asesor_id: Number(r.asesor_id),
    bucket: Number(r.bucket),
    capacidad_base: Number(r.capacidad_base),
    margen_alerta_tipo: r.margen_alerta_tipo === "fijo" ? "fijo" : "porcentaje",
    margen_alerta_valor: Number(r.margen_alerta_valor),
  }));
}

/**
 * Carga de cuentas por asesor y bucket. Capacidad, % de utilización,
 * sobrecarga y alerta de nueva posición son SIEMPRE por combinación
 * asesor+bucket (ticket: techo de 300 es "la cantidad que puede atender un
 * asesor", no un agregado del bucket). El resumen por bucket es informativo:
 * cuentas totales + conteos de cuántos de sus asesores están en
 * alerta/sobrecarga. Filtros opcionales por bucket / asesor_id.
 */
export async function getCargaPorAsesorBucket(params: {
  bucket?: number;
  asesor_id?: number;
} = {}): Promise<CargaPorAsesorBucketResultado> {
  const [cuentas, catalogo, pool] = await Promise.all([
    getCuentasPorAsesorYBucket(params),
    getCatalogoBuckets(),
    getPoolPorBucket(params),
  ]);

  // capacidad_base + margen por (asesor_id, bucket) — de la fila del pool si
  // el asesor está en él; defaults si no (fuera de pool, sin fila propia).
  const poolDataPorAsesorBucket = new Map<
    string,
    { capacidad: number; margenTipo: MargenAlertaTipo; margenValor: number }
  >();
  const poolPorBucket = new Map<number, Set<number>>();
  for (const p of pool) {
    if (!poolPorBucket.has(p.bucket)) poolPorBucket.set(p.bucket, new Set());
    poolPorBucket.get(p.bucket)!.add(p.asesor_id);
    poolDataPorAsesorBucket.set(`${p.asesor_id}:${p.bucket}`, {
      capacidad: p.capacidad_base,
      margenTipo: p.margen_alerta_tipo,
      margenValor: p.margen_alerta_valor,
    });
  }

  // Acumular cuentas por asesor y por bucket (una fila por asesor con detalle
  // de todos los buckets donde tiene al menos 1 cuenta).
  const asesorMap = new Map<
    number,
    { asesor_id: number; nombre: string; email_asesor: string | null; porBucket: Map<number, number> }
  >();
  const cuentasPorBucket = new Map<number, number>();
  for (const fila of cuentas) {
    if (!asesorMap.has(fila.asesor_id)) {
      asesorMap.set(fila.asesor_id, {
        asesor_id: fila.asesor_id,
        nombre: fila.nombre,
        email_asesor: fila.email_asesor,
        porBucket: new Map(),
      });
    }
    asesorMap.get(fila.asesor_id)!.porBucket.set(fila.bucket, fila.cuentas);
    cuentasPorBucket.set(fila.bucket, (cuentasPorBucket.get(fila.bucket) ?? 0) + fila.cuentas);
  }

  // Conteos por bucket de asesores en alerta/sobrecarga, derivados del mismo
  // recorrido de abajo (se llenan mientras se construye porAsesor).
  const alertaPorBucket = new Map<number, number>();
  const sobrecargaPorBucket = new Map<number, number>();

  const porAsesor: CargaPorAsesor[] = Array.from(asesorMap.values())
    .map((a) => ({
      asesor_id: a.asesor_id,
      nombre: a.nombre,
      email_asesor: a.email_asesor,
      porBucket: Array.from(a.porBucket.entries())
        .map(([bucket, cuentas]) => {
          const poolData = poolDataPorAsesorBucket.get(`${a.asesor_id}:${bucket}`);
          const capacidad = poolData?.capacidad ?? CAPACIDAD_BASE_DEFAULT;
          const margenTipo = poolData?.margenTipo ?? MARGEN_ALERTA_TIPO_DEFAULT;
          const margenValor = poolData?.margenValor ?? MARGEN_ALERTA_VALOR_DEFAULT;
          const umbralAlertaCuentas = capacidad + resolverMargen(capacidad, margenTipo, margenValor);
          const utilizacionPct =
            capacidad > 0 ? Math.round((cuentas / capacidad) * 1000) / 10 : 0;
          const sobrecarga = cuentas > capacidad;
          const alerta = cuentas >= umbralAlertaCuentas;
          if (alerta) alertaPorBucket.set(bucket, (alertaPorBucket.get(bucket) ?? 0) + 1);
          if (sobrecarga) sobrecargaPorBucket.set(bucket, (sobrecargaPorBucket.get(bucket) ?? 0) + 1);
          return {
            bucket,
            cuentas,
            capacidad_base: capacidad,
            utilizacion_pct: utilizacionPct,
            elegible: poolPorBucket.get(bucket)?.has(a.asesor_id) ?? false,
            sobrecarga,
            alerta_nueva_posicion: alerta,
            umbral_alerta_cuentas: Math.round(umbralAlertaCuentas * 10) / 10,
            margen_alerta_tipo: margenTipo,
            margen_alerta_valor: margenValor,
          };
        })
        .sort((x, y) => x.bucket - y.bucket),
    }))
    .sort((a, b) => a.nombre.localeCompare(b.nombre));

  const bucketsResumen: CargaPorBucketResumen[] = catalogo
    .filter((b) => params.bucket === undefined || b.numero === params.bucket)
    .map((b) => ({
      numero: b.numero,
      prefijo: b.prefijo,
      nombre: b.nombre,
      color: b.color,
      cuentas_totales: cuentasPorBucket.get(b.numero) ?? 0,
      asesores_en_pool: poolPorBucket.get(b.numero)?.size ?? 0,
      asesores_en_alerta: alertaPorBucket.get(b.numero) ?? 0,
      asesores_sobrecargados: sobrecargaPorBucket.get(b.numero) ?? 0,
    }));

  return {
    buckets: bucketsResumen,
    porAsesor,
    fecha: hoyGTStr(),
  };
}
