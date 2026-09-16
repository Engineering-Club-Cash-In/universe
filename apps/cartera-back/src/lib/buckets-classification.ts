import { sql } from "drizzle-orm";
import { SQL_CARTERA_SCHEMA } from "../database/db/schema";

const ZONA_GT = "America/Guatemala";

// CB-030 — "hoy" en zona Guatemala, como string YYYY-MM-DD. Única fuente de
// verdad para comparar contra `fecha_promesa` (columna date) en TODO lugar
// donde se decide si una promesa sigue vigente — isOverdueInstallmentForMora
// (latefee.ts, el freeze real, que la importa de aquí) y
// getPromesaActivaPorCredito (syncPromesasPago.ts, solo lectura para
// carteraFront). Antes cada uno calculaba "hoy" por su cuenta (uno en zona GT,
// otro en UTC) — desalineados cerca de medianoche GT (=06:00 UTC), la promesa
// podía verse vigente en un lado y vencida en el otro durante esa ventana.
//
// Implementación con Intl y NO con `toZonedTime(...).setHours(0,0,0,0)` +
// toISOString(): esa combinación mezcla unidades — setHours opera en la zona
// del PROCESO y toISOString lee en UTC, así que el resultado depende del TZ del
// host. Con TZ en América (deploy actual) coincide, pero con TZ al este de UTC
// (Europe/Madrid, Asia/Tokyo) devuelve el día anterior a TODA hora: la promesa
// se leería vencida un día antes, el freeze se soltaría temprano y el bucket
// subiría. Intl formatea directamente el día calendario en la zona pedida, sin
// depender del TZ del proceso (Codex review PR #1235).
const FORMATO_DIA_GT = new Intl.DateTimeFormat("en-CA", {
  timeZone: ZONA_GT,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function hoyGtISO(ahora: Date = new Date()): string {
  return FORMATO_DIA_GT.format(ahora);
}

// Fila del catálogo de buckets relevante para la derivación.
export type BucketCatalogo = {
  numero: number;
  cuotas_min: number;
  cuotas_max: number | null; // null = abierto (B5 = 5..∞)
  estados_incluidos: string[];
  /**
   * COBROS-02 Fase 4 — estados para los que este bucket es el MÍNIMO.
   *
   * No confundir con `estados_incluidos`, que CLAVA el bucket (INCOBRABLE→B5).
   * Un piso deja subir: `EN_RECUPERACION` con 5 cuotas atrasadas llega a B5
   * conservando el estado, pero nunca baja de B4. Ver bucketDeCredito.
   */
  estados_piso: string[];
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
  /** COBROS-02 Fase 4 — bucket MÍNIMO para estos estados (ver BucketCatalogo). */
  estados_piso: string[];
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

// Estados fuera de los READERS de presentación (tabla por bucket, capacidad, Cola
// del Día, apertura, badge). Igual que STATUS_BUCKET_FUERA pero SIN EN_CONVENIO:
// esos créditos SÍ deben verse — el job de buckets de convenio les siembra su
// bucket/asesor y hay que atenderlos, no dejarlos en el olvido. Ojo: es SOLO para
// lectura/visibilidad; el bucketeo automático (bucketDeCredito) y el motor de mora
// siguen usando STATUS_BUCKET_FUERA, que excluye EN_CONVENIO (ese lo maneja el job
// de convenios). No cambia ninguna operación de escritura.
export const STATUS_READER_FUERA = STATUS_BUCKET_FUERA.filter(
  (s) => s !== "EN_CONVENIO",
);

/**
 * Bucket de un crédito (0-5) resuelto contra el catálogo dinámico `catalogo`.
 *
 * Orden:
 *   (1) estado fuera del funnel → null;
 *   (2) estado que CLAVA un bucket (INCOBRABLE → B5 vía `estados_incluidos`);
 *   (3) rango de cuotas atrasadas;
 *   (4) COBROS-02 Fase 4 — PISO por estado (`estados_piso`): el resultado no
 *       puede quedar por debajo del bucket que el estado fija como mínimo.
 *
 * (2) y (4) son mecanismos DISTINTOS y la diferencia importa: clavar impide
 * subir, y un crédito EN_RECUPERACION clavado en B4 nunca llegaría a B5 con la
 * 5ª cuota (decisión 3 del plan 08). El piso deja subir y prohíbe bajar.
 *
 * El piso se aplica DESPUÉS del rango y no antes: si el atraso ya lo pone más
 * arriba, manda el atraso.
 *
 * Devuelve `null` si el crédito está fuera del funnel operativo (no se trackea).
 */
export function bucketDeCredito(
  status: string | null | undefined,
  cuotasAtrasadas: number,
  catalogo: BucketCatalogo[],
): number | null {
  // (1) Fuera del funnel operativo (lista en código, Opción A).
  if (status && STATUS_BUCKET_FUERA.includes(status)) return null;
  // (2) Estado que fuerza un bucket (p.ej. INCOBRABLE → B5). Clava: gana
  //     incluso sobre el atraso, y por eso se resuelve antes que todo lo demás.
  if (status) {
    const porEstado = catalogo.find((b) => b.estados_incluidos.includes(status));
    if (porEstado) return porEstado.numero;
  }
  // (3) Por rango de cuotas atrasadas (max null = abierto).
  const cuotas = Math.max(cuotasAtrasadas, 0);
  const porRango = catalogo.find(
    (b) => cuotas >= b.cuotas_min && (b.cuotas_max == null || cuotas <= b.cuotas_max),
  );
  if (!porRango) return null;
  // (4) Piso por estado.
  return Math.max(porRango.numero, pisoPorEstado(status, catalogo));
}

/**
 * Bucket mínimo que el estado del crédito impone, o -1 si no impone ninguno
 * (-1 y no 0 a propósito: 0 ES un bucket, y usarlo como "sin piso" haría que un
 * catálogo con `estados_piso` en B0 fuera indistinguible de no tener piso).
 */
export function pisoPorEstado(
  status: string | null | undefined,
  catalogo: BucketCatalogo[],
): number {
  if (!status) return -1;
  const fila = catalogo.find((b) => b.estados_piso?.includes(status));
  return fila ? fila.numero : -1;
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
  GREATEST(
  -- COBROS-02 Fase 4 — PISO por estado (buckets.estados_piso). Va por fuera
  -- del COALESCE y no dentro de una de sus ramas: el bucket de un crédito
  -- EN_RECUPERACION no puede leerse por debajo de B4 venga de donde venga —
  -- ni de una fila vieja del historial, ni del rango de cuotas. Es la misma
  -- regla que aplica bucketDeCredito en JS, y las dos tienen que decir lo
  -- mismo o la tabla por bucket y el motor se contradicen.
  -- NULL cuando el estado no tiene piso, y GREATEST ignora los NULL.
  (SELECT bp.numero FROM ${SQL_CARTERA_SCHEMA}.buckets bp
    WHERE bp.activo = true
      AND ${c}."statusCredit" = ANY (bp.estados_piso)
    ORDER BY bp.numero DESC LIMIT 1),
  COALESCE(
    (SELECT h.bucket_nuevo FROM ${SQL_CARTERA_SCHEMA}.buckets_historial h
      WHERE h.credito_id = ${c}.credito_id
        -- EN_CONVENIO: su bucket lo lleva SOLO el job de convenios (filas con
        -- status_credito='EN_CONVENIO'). Se ignora el historial viejo pre-convenio
        -- (p.ej. el B3 que tenía como MOROSO) — sería un bucket zombie hasta que el
        -- job lo reclasifique (review Codex #1223).
        AND (${c}."statusCredit" <> 'EN_CONVENIO' OR h.status_credito = 'EN_CONVENIO')
      ORDER BY h.fecha DESC, h.historial_id DESC
      LIMIT 1),
    -- El fallback VIVO (estado/rango de mora) NO aplica a EN_CONVENIO: sin fila del
    -- job su bucket es DESCONOCIDO (null), no B0 — la derivación viva no entiende
    -- convenios y, como al crear el convenio se borra la mora, caería a B0 ("al
    -- día") en la ventana previa a la 1ª corrida del job. null → badge sin bucket /
    -- no cuenta en capacidad, hasta que el job lo siembre (review Codex #1223).
    (SELECT b.numero FROM ${SQL_CARTERA_SCHEMA}.buckets b
      WHERE b.activo = true
        AND ${c}."statusCredit" <> 'EN_CONVENIO'
        AND ${c}."statusCredit" = ANY (b.estados_incluidos)
      ORDER BY b.numero LIMIT 1),
    (SELECT b.numero FROM ${SQL_CARTERA_SCHEMA}.buckets b
      WHERE b.activo = true
        AND ${c}."statusCredit" <> 'EN_CONVENIO'
        AND COALESCE(${m}.cuotas_atrasadas, 0) >= b.cuotas_min
        AND (b.cuotas_max IS NULL OR COALESCE(${m}.cuotas_atrasadas, 0) <= b.cuotas_max)
      ORDER BY b.numero LIMIT 1)
  ))
`;
};
