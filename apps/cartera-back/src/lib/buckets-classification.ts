import { sql } from "drizzle-orm";
import { SQL_CARTERA_SCHEMA } from "../database/db/schema";

// Fila del catálogo de buckets relevante para la derivación.
export type BucketCatalogo = {
  numero: number;
  cuotas_min: number;
  cuotas_max: number | null; // null = abierto (B5 = 5..∞)
  estados_incluidos: string[];
};

/**
 * Fila completa del catálogo `cartera.buckets` expuesta a consumidores
 * externos (CRM vía API) — incluye el puente `estado_mora` (numero↔estadoMora).
 */
export type BucketCatalogoCompleto = {
  numero: number;
  prefijo: string;
  nombre: string;
  descripcion: string | null;
  cuotas_min: number;
  cuotas_max: number | null;
  estados_incluidos: string[];
  es_operativo: boolean;
  orden: number;
  color: string | null;
  estado_mora: string | null;
  /** CB-020: días de SLA para contactar desde que el crédito ENTRÓ a este bucket. null = sin SLA (B0). */
  dias_sla: number | null;
};

// El bucket se DERIVA del catálogo dinámico `cartera.buckets` (nombres, rangos y
// estados configurables → filtros full dinámicos). Lo único que queda en código
// es la lista de estados FUERA del funnel operativo (Opción A): esos créditos ya
// no llevan mora ni se trackean como bucket.
export const STATUS_BUCKET_FUERA = [
  "CANCELADO",
  "PENDIENTE_CANCELACION",
  "EN_CONVENIO",
  "CAIDO",
];

/**
 * Bucket de un crédito (0-5) resuelto contra el catálogo dinámico `catalogo`.
 * Orden: (1) estado fuera del funnel → null; (2) estado que fuerza un bucket
 * (p.ej. INCOBRABLE → B5 vía `estados_incluidos`); (3) rango de cuotas atrasadas.
 * Devuelve `null` si el crédito está fuera del funnel operativo (no se trackea).
 */
export function bucketDeCredito(
  status: string | null | undefined,
  cuotasAtrasadas: number,
  catalogo: BucketCatalogo[],
): number | null {
  // (1) Fuera del funnel operativo (lista en código, Opción A).
  if (status && STATUS_BUCKET_FUERA.includes(status)) return null;
  // (2) Estado que fuerza un bucket (p.ej. INCOBRABLE → B5).
  if (status) {
    const porEstado = catalogo.find((b) => b.estados_incluidos.includes(status));
    if (porEstado) return porEstado.numero;
  }
  // (3) Por rango de cuotas atrasadas (max null = abierto).
  const cuotas = Math.max(cuotasAtrasadas, 0);
  const porRango = catalogo.find(
    (b) => cuotas >= b.cuotas_min && (b.cuotas_max == null || cuotas <= b.cuotas_max),
  );
  return porRango ? porRango.numero : null;
}

/**
 * Fragmento SQL compartido: bucket ACTUAL de un crédito ya presente en el
 * FROM/JOIN de la query que lo usa — COALESCE(último buckets_historial →
 * estado que fuerza bucket vía estados_incluidos → rango de cuotas de la mora
 * activa).
 *
 * `credAlias`/`moraAlias` son PARÁMETROS explícitos (no un comentario que se
 * puede ignorar): el caller debe declarar en el FROM/JOIN de su query una
 * tabla `creditos` con ese alias y un LEFT JOIN `moras_credito` (ON
 * moraAlias.credito_id = credAlias.credito_id AND moraAlias.activa = true)
 * con el suyo. Si el alias no coincide, Postgres falla en tiempo de query con
 * "missing FROM-clause entry" — señal clara e inmediata, no un resultado
 * incorrecto silencioso.
 *
 * Única fuente de este COALESCE — antes vivía duplicado carácter por carácter
 * en reasignarAsesor.ts (bucketActualDeCredito) y cargaAsesorBucket.ts
 * (CTE bucket_actual); ambos ahora lo importan de aquí para no divergir.
 */
export const bucketActualSql = (credAlias: string, moraAlias: string) => {
  const c = sql.raw(credAlias);
  const m = sql.raw(moraAlias);
  return sql`
  COALESCE(
    (SELECT h.bucket_nuevo FROM ${SQL_CARTERA_SCHEMA}.buckets_historial h
      WHERE h.credito_id = ${c}.credito_id
      ORDER BY h.fecha DESC, h.historial_id DESC
      LIMIT 1),
    (SELECT b.numero FROM ${SQL_CARTERA_SCHEMA}.buckets b
      WHERE b.activo = true
        AND ${c}."statusCredit" = ANY (b.estados_incluidos)
      ORDER BY b.numero LIMIT 1),
    (SELECT b.numero FROM ${SQL_CARTERA_SCHEMA}.buckets b
      WHERE b.activo = true
        AND COALESCE(${m}.cuotas_atrasadas, 0) >= b.cuotas_min
        AND (b.cuotas_max IS NULL OR COALESCE(${m}.cuotas_atrasadas, 0) <= b.cuotas_max)
      ORDER BY b.numero LIMIT 1)
  )
`;
};
