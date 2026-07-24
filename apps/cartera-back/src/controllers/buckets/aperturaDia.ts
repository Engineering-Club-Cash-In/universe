import { sql } from "drizzle-orm";
import { db } from "../../database";
import { SQL_CARTERA_SCHEMA } from "../../database/db/schema";
import { STATUS_BUCKET_FUERA } from "../../lib/buckets-classification";

// ─────────────────────────────────────────────────────────────────────────────
// CB-023 · Buckets — Vista de APERTURA MATUTINA para el supervisor (8:00 AM).
// Una sola llamada que arma 3 secciones (la 4ª — asignación del día — la compone
// el CRM con getCargaPorAsesorBucket, CB-018, para no duplicar esa lógica):
//
//   1. Cuentas NUEVAS por bucket   → transiciones de buckets_historial del día.
//   2. Cumplimiento del día ANTERIOR → de las cuotas que vencían ayer, cuántas
//      se pagaron (cuentas + monto).
//   3. TOP 3 por bucket            → los 3 créditos más críticos de cada bucket,
//      ordenados por monto ADEUDADO.
//
// ⚠️ FÓRMULA DEL MONTO ADEUDADO (decisión CB-023, confirmada con el usuario):
//   monto_adeudado = (cuotas_vencidas_reales × creditos.cuota) + monto_mora
// `moras_credito.monto_mora` es SOLO el RECARGO (capital × % × cuotas
// atrasadas) — NO incluye las cuotas vencidas (mismo detalle que documenta
// cuotasProximas.ts:184). Por eso hay que sumar las cuotas vencidas por su
// valor (creditos.cuota, fijo por crédito — cuotas_credito no tiene columna de
// monto) además del recargo. Este orden ya incorpora "prioridad los de mayor
// monto de cuota" (una cuota de 10k pesa 10k por cada vencida) y además pesa la
// antigüedad (más cuotas vencidas = más adeudado).
//
// ⚠️ moras_credito es una FOTO que solo se refresca cuando corre procesarMoras.
// Por eso `cuotas_vencidas_reales` se cuenta EN VIVO desde cuotas_credito
// (espejo de cuotasProximas.ts / isOverdueInstallmentForMora en latefee.ts),
// no desde m.cuotas_atrasadas. `monto_mora` sí sale de la foto (no hay forma de
// recalcular el recargo en vivo); si el job no ha corrido, el recargo puede
// estar viejo — aceptable: el orden lo domina el vencido.
//
// ⚠️ `dias_mora` se deriva de la cuota vencida MÁS VIEJA (MIN fecha_vencimiento
// de las pendientes), NO de moras_credito.created_at — este último se reinicia
// si la mora se desactiva y se vuelve a crear.
//
// ⚠️ ALCANCE HISTÓRICO. Bucket, cuotas vencidas y pago se calculan a la fecha
// `f` (buckets_historial y pagos tienen fecha). Pero el DUEÑO del crédito
// (creditos.asesor_id) y su STATUS (creditos."statusCredit") se leen del estado
// ACTUAL: no hay historial continuo de status, y reconstruir el dueño exacto
// desde credito_asesor_historial en cada sección no compensa para una vista que
// se usa sobre todo HOY. Por eso el router acota la fecha a una ventana reciente
// (APERTURA_DIAS_ATRAS en routers/buckets.ts): en pocos días dueño y status casi
// no cambian, así que la foto sigue siendo fiel. Fuera de esa ventana el
// endpoint responde 400 en vez de una foto silenciosamente incorrecta.
// ─────────────────────────────────────────────────────────────────────────────

// Fila de pago que realmente cubre una cuota (predicado espejo del motor de
// moras — mismo criterio que cuotasProximas.pagoCubriente para no divergir).
//
// `hasta` (opcional): solo cuenta pagos registrados AL DÍA `hasta` o antes.
// Necesario para las secciones que miran un día PASADO — sin esa cota, una
// cuota que vencía el 10 pero se pagó el 15 se leería como no-vencida al
// revisar el 10. Se usa `fecha_pago` (fallback a `fecha_aplicado` para pagos
// viejos sin registrar), convertido a día GT. Sin `hasta` el predicado es el
// clásico "pagó alguna vez".
const pagoCubriente = (
  cuotaIdCol: ReturnType<typeof sql.raw>,
  hasta?: ReturnType<typeof sql>,
) => sql`
  SELECT 1 FROM ${SQL_CARTERA_SCHEMA}.pagos_credito pc
  WHERE pc.cuota_id = ${cuotaIdCol}
    AND pc."paymentFalse" = false
    AND pc.pagado = true
    AND pc.validation_status IN ('validated', 'no_required')
    AND COALESCE(pc.monto_aplicado, 0) > 0${
      hasta
        ? sql`
    AND ${diaGTDe("COALESCE(pc.fecha_pago, pc.fecha_aplicado)")}::date <= ${hasta}`
        : sql``
    }`;

/**
 * Predicado "la cuota `v` seguía vencida al cierre del día `f`". Se usa en las
 * secciones históricas (top3, movimientos) — el cumplimiento tiene su propia
 * lógica porque ahí sí importa quién pagó, sin importar cuándo.
 *
 * Una cuota cuenta como vencida-a-la-fecha si venció antes de `f` y NO estaba
 * pagada ESE día. "Pagada ese día" tiene dos formas:
 *  - Pago real cubriente con fecha <= f  → pagoCubriente(v, f).
 *  - Legado: `cuotas_credito.pagado = true` SIN ninguna fila de pago cubriente
 *    (data vieja, ~2.7k filas en el schema real). Esas no traen fecha de pago,
 *    así que no se pueden ubicar en el tiempo; se tratan como pagadas siempre
 *    —el mismo criterio con el que el motor de moras ya convive— para no
 *    inflar el histórico con miles de falsos vencidos.
 * `v` es el alias de cuotas_credito en la subquery que lo llama.
 */
const cuotaVencidaALaFecha = (v: string, f: ReturnType<typeof sql>) => {
  const vr = sql.raw(v);
  return sql`
    ${vr}.fecha_vencimiento::date < ${f}
    AND NOT EXISTS (${pagoCubriente(sql.raw(`${v}.cuota_id`), f)})
    AND NOT (
      ${vr}.pagado = true
      AND NOT EXISTS (${pagoCubriente(sql.raw(`${v}.cuota_id`))})
    )`;
};

// Estados que NO devengan mora (espejo de ESTADOS_SIN_MORA en cuotasProximas.ts
// / STATUS_EXCLUIDOS_MORA en latefee.ts).
const ESTADOS_SIN_MORA = sql`('EN_CONVENIO', 'INCOBRABLE', 'CANCELADO', 'PENDIENTE_CANCELACION', 'CAIDO')`;

/**
 * Tope de sanidad para el detalle de movimientos del día — la ÚNICA query de
 * esta vista que devuelve filas por crédito (las otras 4 son agregados
 * acotados por el catálogo o por el número de asesores, igual que
 * cargaAsesorBucket.ts, que tampoco lleva LIMIT).
 *
 * NO es paginación: son los movimientos de UN día (decenas en operación
 * normal) y el front filtra por bucket en memoria para que el chip responda
 * sin volver al server. El tope existe para que una corrida masiva del job
 * —una migración, un recálculo histórico— no traiga miles de filas de golpe.
 * Mismo valor que el techo de página de colaDia.ts/bucketsHistorial.ts.
 */
const MAX_MOVIMIENTOS_DIA = 500;

/**
 * Día GT de un timestamp de `buckets_historial.fecha`.
 *
 * Las DOS etapas son obligatorias y el orden importa: `fecha` es `timestamp`
 * SIN timezone (se guarda con now() = UTC), así que primero hay que MARCARLO
 * como UTC y recién después convertirlo a Guatemala. Con una sola conversión
 * a 'America/Guatemala' Postgres INTERPRETA el naive como hora GT y lo pasa a
 * UTC — suma 6h en vez de restarlas, y todo evento posterior a las 18:00 GT
 * se contaba en el día siguiente (bug real, detectado con datos de prueba:
 * un evento de las 21:26 del 23-jul salía como 24-jul y desaparecía del
 * filtro de "hoy" — justo la franja en que corre el job de moras).
 *
 * Vive en un solo lugar a propósito: las 4 queries de esta vista lo usan y
 * duplicar la expresión es exactamente cómo el bug volvería en una sola.
 * Mismo patrón que bucketsHistorial.ts:43 y colaDia.ts:149.
 */
const diaGTDe = (col: string) =>
  sql`(${sql.raw(col)} AT TIME ZONE 'UTC' AT TIME ZONE 'America/Guatemala')`;

/**
 * Bucket de un crédito TAL COMO ESTABA al cierre de un día `f` (no "ahora").
 *
 * `bucketActualSql` (lib/buckets-classification) da el bucket ACTUAL — su
 * subquery toma el último `buckets_historial` sin cota de fecha. Sirve para la
 * carga de hoy, pero en la apertura de un día PASADO desincroniza: las cuotas
 * vencidas se cuentan a la fecha `f`, y si el crédito se movió de bucket
 * DESPUÉS de `f`, quedaría rankeado bajo un bucket que no tenía ese día. Aquí
 * el bucket se deriva del último evento CON `fecha <= f` para que ambos lados
 * (bucket y cuotas) sean la misma foto.
 *
 * Con `f = hoy` el resultado coincide con `bucketActualSql` (todos los eventos
 * pasan la cota), así que la vista del día actual no cambia. Los fallbacks por
 * estado y por rango de mora son intencionalmente "de ahora": para un día
 * pasado sin ningún INICIAL registrado no hay foto histórica que reconstruir,
 * y es el mismo criterio que ya usa el resto del motor.
 */
const bucketALaFechaSql = (
  credAlias: string,
  moraAlias: string,
  f: ReturnType<typeof sql>,
) => {
  const c = sql.raw(credAlias);
  const m = sql.raw(moraAlias);
  return sql`
  COALESCE(
    (SELECT h.bucket_nuevo FROM ${SQL_CARTERA_SCHEMA}.buckets_historial h
      WHERE h.credito_id = ${c}.credito_id
        AND ${diaGTDe("h.fecha")}::date <= ${f}
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

// ─────────────────────────── Tipos de respuesta ────────────────────────────

/**
 * De dónde vinieron los créditos que ENTRARON a un bucket. `bucket_anterior`
 * null solo en eventos INICIAL (que aquí no entran: filtramos SUBIDA/BAJADA),
 * así que en la práctica siempre trae origen.
 */
export type CuentasNuevasOrigen = {
  desde: number; // bucket de origen
  tipo: "SUBIDA" | "BAJADA";
  cantidad: number;
};

export type CuentasNuevasBucket = {
  bucket: number;
  entradas: number; // SUBIDA + BAJADA que aterrizan en este bucket
  subidas: number;
  bajadas: number;
  // Desglose "2 subieron desde B0, 3 bajaron desde B2": ordenado por cantidad
  // desc para que el origen dominante se lea primero.
  origenes: CuentasNuevasOrigen[];
};

/**
 * Un crédito que cambió de bucket hoy. Trae TODO el contexto (adeudado, días
 * en mora, asesor) aunque el front hoy muestre solo las columnas básicas: así
 * agregar una columna o una fila expandible no requiere tocar el backend.
 */
export type MovimientoCredito = {
  credito_id: number;
  numero_credito_sifco: string | null;
  cliente: string | null;
  bucket_anterior: number | null;
  bucket_nuevo: number;
  tipo_evento: "SUBIDA" | "BAJADA";
  // Saltos de bucket del movimiento (B1→B3 = 2). Permite marcar escalaciones
  // fuertes sin recalcular en el front.
  saltos: number;
  status_credito: string | null;
  cuotas_vencidas: number;
  monto_cuota: number;
  monto_mora: number;
  monto_adeudado: number;
  dias_mora: number;
  asesor_id: number | null;
  asesor: string | null;
  fecha: string; // timestamp del evento, ya en hora GT
};

export type Top3Fila = {
  credito_id: number;
  numero_credito_sifco: string | null;
  cliente: string | null;
  bucket: number;
  status_credito: string;
  cuotas_vencidas: number;
  monto_cuota: number;
  monto_mora: number;
  monto_adeudado: number;
  dias_mora: number;
  asesor_id: number | null;
  asesor: string | null;
};

export type Top3Bucket = {
  bucket: number;
  total_criticos: number; // cuentas con ≥1 cuota vencida en el bucket
  peor_monto: number; // monto_adeudado del #1 (para el encabezado del acordeón)
  top: Top3Fila[];
};

export type Cumplimiento = {
  fecha: string; // el día evaluado (ayer respecto de `fecha`)
  cuentas_esperadas: number;
  cuentas_pagadas: number;
  pct: number; // 0..100, 0 si no había cuotas esperadas (nunca NaN)
  monto_esperado: number;
  monto_pagado: number;
};

/**
 * CB-023 · "Asignación del día": qué cuentas NUEVAS le cayeron HOY a cada
 * asesor por transición de bucket. Lo accionable a las 8 AM es el DELTA del
 * día por asesor, no el acumulado de carga (eso ya lo responde CB-018 en
 * /cobros/carga).
 *
 * Solo cuentan las ENTRADAS al bucket que el asesor atiende (su pool en
 * asesor_bucket): lo que se le FUE a otro bucket ya no es trabajo suyo — pasa
 * a ser del asesor que atiende el bucket destino. Un asesor sin entradas en el
 * día no aparece en la lista.
 *
 * Es el cruce de las transiciones de hoy (buckets_historial) con el dueño
 * ACTUAL del crédito (creditos.asesor_id, decisión de raíz del modelo).
 */
/**
 * Un ingreso agregado al bucket del asesor: "2 cuentas entraron desde B1".
 *
 * NO se distingue SUBIDA de BAJADA: para el asesor que RECIBE la cuenta el
 * hecho relevante es que le entró trabajo nuevo — que el crédito viniera
 * empeorando (subida) o mejorando (bajada) es historia del bucket de origen,
 * no de él. Por eso el conteo es uno solo y lo único que se conserva es de
 * dónde vino.
 */
export type AsignacionAsesorBucket = {
  desde: number | null;
  bucket: number; // destino (= bucket que atiende el asesor)
  cantidad: number;
};

export type AsignacionDiaAsesor = {
  asesor_id: number | null; // null = créditos sin asesor asignado
  asesor: string | null;
  // Cuentas que ENTRARON hoy al bucket del asesor, sin distinguir si venían
  // subiendo o bajando (ver AsignacionAsesorBucket).
  ingresos: number;
  // Bucket(s) del POOL del asesor (asesor_bucket): a qué buckets está asignado
  // a atender. Es config estable, distinta de `porBucket` (de dónde vinieron
  // los ingresos de HOY). Array porque el modelo permite varios por asesor,
  // aunque hoy cada uno tenga solo el suyo.
  buckets_pool: number[];
  porBucket: AsignacionAsesorBucket[];
};

export type AperturaDiaResultado = {
  fecha: string;
  cuentas_nuevas: CuentasNuevasBucket[];
  cumplimiento: Cumplimiento;
  top3: Top3Bucket[];
  asignacion: AsignacionDiaAsesor[];
  // Detalle crédito por crédito de los movimientos del día (el agregado vive
  // en `cuentas_nuevas`). El front lo filtra por bucket destino.
  movimientos: MovimientoCredito[];
};

// ─────────────────────────── Funciones puras ───────────────────────────────
// Exportadas para test aislado (sin DB). El SQL las replica en set-based; estas
// son la especificación legible y el punto de verificación.

/**
 * Monto adeudado de un crédito para el ranking de apertura.
 * (cuotas vencidas × valor de cuota) + recargo de mora.
 */
export function calcularMontoAdeudado(
  cuotasVencidas: number,
  montoCuota: number,
  montoMora: number,
): number {
  const vencidas = Math.max(cuotasVencidas, 0);
  const cuota = Number.isFinite(montoCuota) ? montoCuota : 0;
  const mora = Number.isFinite(montoMora) ? montoMora : 0;
  return vencidas * cuota + mora;
}

/**
 * Ordena las filas de un bucket por monto adeudado (desc), desempata por
 * cuotas vencidas (desc) y luego por credito_id (asc, determinístico), y corta
 * a las primeras `n` (default 3).
 */
export function rankearTop3<T extends { monto_adeudado: number; cuotas_vencidas: number; credito_id: number }>(
  filas: T[],
  n = 3,
): T[] {
  return [...filas]
    .sort((a, b) => {
      if (b.monto_adeudado !== a.monto_adeudado) return b.monto_adeudado - a.monto_adeudado;
      if (b.cuotas_vencidas !== a.cuotas_vencidas) return b.cuotas_vencidas - a.cuotas_vencidas;
      return a.credito_id - b.credito_id;
    })
    .slice(0, n);
}

/**
 * Resume el cumplimiento del día: pct = pagadas / esperadas × 100.
 * Sin cuotas esperadas → pct 0 (nunca división por cero / NaN).
 */
export function resumirCumplimiento(input: {
  fecha: string;
  cuentas_esperadas: number;
  cuentas_pagadas: number;
  monto_esperado: number;
  monto_pagado: number;
}): Cumplimiento {
  const esperadas = Math.max(input.cuentas_esperadas, 0);
  const pagadas = Math.max(input.cuentas_pagadas, 0);
  const pct = esperadas > 0 ? Math.round((pagadas / esperadas) * 1000) / 10 : 0;
  return {
    fecha: input.fecha,
    cuentas_esperadas: esperadas,
    cuentas_pagadas: pagadas,
    pct,
    monto_esperado: input.monto_esperado,
    monto_pagado: input.monto_pagado,
  };
}

// ─────────────────────────── Queries ───────────────────────────────────────

// Fecha default = hoy en GT (mismo patrón que cuotasProximas.ts). Se pasa como
// literal validado (esFecha en el router) — nunca input crudo al ::date.
function fechaSql(fecha?: string) {
  return fecha
    ? sql`${fecha}::date`
    : sql`(now() AT TIME ZONE 'America/Guatemala')::date`;
}

/**
 * Bloque 1: transiciones del día por bucket DESTINO, con el desglose de
 * dónde vino cada entrada ("2 subieron desde B0, 3 bajaron desde B2").
 * Se agrupa por (destino, origen, tipo) y se pliega en memoria — el volumen
 * es de a lo sumo 6×6×2 filas, no vale una segunda query.
 */
async function getCuentasNuevas(fecha?: string): Promise<CuentasNuevasBucket[]> {
  const f = fechaSql(fecha);
  const res = await db.execute<{
    bucket: number;
    desde: number | null;
    tipo_evento: "SUBIDA" | "BAJADA";
    cantidad: number;
  }>(sql`
    SELECT
      h.bucket_nuevo AS bucket,
      h.bucket_anterior AS desde,
      h.tipo_evento,
      COUNT(*)::int AS cantidad
    FROM ${SQL_CARTERA_SCHEMA}.buckets_historial h
    -- fecha es timestamp SIN timezone (se guarda con now() = UTC). La
    -- conversión a día GT necesita las DOS etapas: marcar el naive como UTC y
    -- recién ahí pasarlo a Guatemala. Con una sola conversión a
    -- America/Guatemala, Postgres INTERPRETA el naive como hora GT y lo
    -- convierte a UTC (+6h) — dirección invertida, que empujaba los eventos de
    -- la tarde al día siguiente y los dejaba fuera del filtro. Mismo patrón que
    -- bucketsHistorial.ts:43 y colaDia.ts:149.
    WHERE ${diaGTDe("h.fecha")}::date = ${f}
      AND h.tipo_evento IN ('SUBIDA', 'BAJADA')
    GROUP BY h.bucket_nuevo, h.bucket_anterior, h.tipo_evento
    ORDER BY h.bucket_nuevo, COUNT(*) DESC
  `);

  const porBucket = new Map<number, CuentasNuevasBucket>();
  for (const r of res.rows) {
    const bucket = Number(r.bucket);
    let grupo = porBucket.get(bucket);
    if (!grupo) {
      grupo = { bucket, entradas: 0, subidas: 0, bajadas: 0, origenes: [] };
      porBucket.set(bucket, grupo);
    }
    const cantidad = Number(r.cantidad);
    if (r.tipo_evento === "SUBIDA") grupo.subidas += cantidad;
    else grupo.bajadas += cantidad;
    grupo.entradas += cantidad;
    // bucket_anterior es NOT NULL para SUBIDA/BAJADA (lo garantiza el CHECK
    // de coherencia de la tabla), pero el tipo lo permite: -1 sería un dato
    // corrupto, mejor visible que escondido.
    grupo.origenes.push({
      desde: r.desde != null ? Number(r.desde) : -1,
      tipo: r.tipo_evento,
      cantidad,
    });
  }
  return [...porBucket.values()].sort((a, b) => a.bucket - b.bucket);
}

/**
 * Detalle crédito por crédito de los movimientos del día. Trae TODO el
 * contexto del crédito (adeudado, días en mora, asesor) aunque el front hoy
 * pinte solo algunas columnas — así crecer la tabla no toca backend.
 *
 * Sin paginar a propósito: son los movimientos de UN día (decenas, no miles);
 * el front filtra por bucket destino en memoria y así el chip responde
 * instantáneo sin ida y vuelta al server.
 */
async function getMovimientosDia(fecha?: string): Promise<MovimientoCredito[]> {
  const f = fechaSql(fecha);
  const res = await db.execute<{
    credito_id: number;
    numero_credito_sifco: string | null;
    cliente: string | null;
    bucket_anterior: number | null;
    bucket_nuevo: number;
    tipo_evento: "SUBIDA" | "BAJADA";
    status_credito: string | null;
    cuotas_vencidas: number;
    monto_cuota: string;
    monto_mora: string;
    monto_adeudado: string;
    dias_mora: number;
    asesor_id: number | null;
    asesor: string | null;
    fecha: string;
  }>(sql`
    SELECT
      h.credito_id,
      c.numero_credito_sifco,
      u.nombre AS cliente,
      h.bucket_anterior,
      h.bucket_nuevo,
      h.tipo_evento,
      COALESCE(h.status_credito, c."statusCredit") AS status_credito,
      cv.cuotas_vencidas,
      ROUND(c.cuota::numeric, 2)::text AS monto_cuota,
      ROUND(COALESCE(m.monto_mora, 0)::numeric, 2)::text AS monto_mora,
      ROUND(
        (cv.cuotas_vencidas * c.cuota + COALESCE(m.monto_mora, 0))::numeric, 2
      )::text AS monto_adeudado,
      COALESCE((${f} - cv.mas_vieja), 0)::int AS dias_mora,
      c.asesor_id,
      a.nombre AS asesor,
      to_char(${diaGTDe("h.fecha")}, 'YYYY-MM-DD"T"HH24:MI:SS') AS fecha
    FROM ${SQL_CARTERA_SCHEMA}.buckets_historial h
    INNER JOIN ${SQL_CARTERA_SCHEMA}.creditos c ON c.credito_id = h.credito_id
    INNER JOIN ${SQL_CARTERA_SCHEMA}.usuarios u ON u.usuario_id = c.usuario_id
    LEFT JOIN ${SQL_CARTERA_SCHEMA}.asesores a ON a.asesor_id = c.asesor_id
    LEFT JOIN ${SQL_CARTERA_SCHEMA}.moras_credito m
      ON m.credito_id = c.credito_id AND m.activa = true
    -- Cuotas vencidas EN VIVO + la más vieja (para días de mora), mismo
    -- criterio que getTop3PorBucket. LATERAL para calcular ambas de una pasada.
    LEFT JOIN LATERAL (
      SELECT
        COUNT(*)::int AS cuotas_vencidas,
        MIN(v.fecha_vencimiento)::date AS mas_vieja
      FROM ${SQL_CARTERA_SCHEMA}.cuotas_credito v
      WHERE v.credito_id = c.credito_id
        AND ${cuotaVencidaALaFecha("v", f)}
    ) cv ON true
    WHERE ${diaGTDe("h.fecha")}::date = ${f}
      AND h.tipo_evento IN ('SUBIDA', 'BAJADA')
    -- Lo más grave primero: subidas antes que bajadas, y dentro de cada una el
    -- bucket destino más alto arriba. El orden de SUBIDA/BAJADA va por CASE
    -- explícito, NO por tipo_evento DESC: es un enum
    -- ('INICIAL','SUBIDA','BAJADA') y Postgres ordena enums por su orden de
    -- DECLARACIÓN, así que DESC pondría BAJADA (declarado después) antes que
    -- SUBIDA — lo contrario de lo que queremos, y con el LIMIT un día pesado
    -- cortaría las subidas (lo grave) dejando bajadas.
    ORDER BY
      CASE h.tipo_evento WHEN 'SUBIDA' THEN 0 ELSE 1 END,
      h.bucket_nuevo DESC,
      h.historial_id DESC
    LIMIT ${MAX_MOVIMIENTOS_DIA}
  `);

  return res.rows.map((r) => {
    const anterior = r.bucket_anterior != null ? Number(r.bucket_anterior) : null;
    const nuevo = Number(r.bucket_nuevo);
    return {
      credito_id: Number(r.credito_id),
      numero_credito_sifco: r.numero_credito_sifco,
      cliente: r.cliente,
      bucket_anterior: anterior,
      bucket_nuevo: nuevo,
      tipo_evento: r.tipo_evento,
      saltos: anterior != null ? Math.abs(nuevo - anterior) : 0,
      status_credito: r.status_credito,
      cuotas_vencidas: Number(r.cuotas_vencidas ?? 0),
      monto_cuota: Number(r.monto_cuota),
      monto_mora: Number(r.monto_mora),
      monto_adeudado: Number(r.monto_adeudado),
      dias_mora: Number(r.dias_mora),
      asesor_id: r.asesor_id != null ? Number(r.asesor_id) : null,
      asesor: r.asesor,
      fecha: r.fecha,
    };
  });
}

/** Bloque 3: hasta 3 créditos más críticos por bucket + total de críticos. */
async function getTop3PorBucket(fecha?: string): Promise<Top3Bucket[]> {
  const f = fechaSql(fecha);
  const fueraSql = sql.join(STATUS_BUCKET_FUERA.map((s) => sql`${s}`), sql`, `);

  // cuotas_vencidas_reales EN VIVO (CASE de estados sin mora, espejo de
  // cuotasProximas.ts). monto_adeudado = vencidas × cuota + recargo.
  // ROW_NUMBER particionado por bucket corta a 3 EN SQL — no traer ~1,600
  // créditos del funnel para quedarse con 18.
  const res = await db.execute<{
    credito_id: number;
    numero_credito_sifco: string | null;
    cliente: string | null;
    bucket: number;
    status_credito: string;
    cuotas_vencidas: number;
    monto_cuota: string;
    monto_mora: string;
    monto_adeudado: string;
    dias_mora: number;
    asesor_id: number | null;
    asesor: string | null;
    total_criticos: number;
    rn: number;
  }>(sql`
    WITH base AS (
      SELECT
        c.credito_id,
        c.numero_credito_sifco,
        u.nombre AS cliente,
        -- Bucket a la fecha f, NO "ahora": debe cuadrar con las cuotas
        -- vencidas, que también se cuentan a f (ver bucketALaFechaSql).
        ${bucketALaFechaSql("c", "m", f)} AS bucket,
        c."statusCredit" AS status_credito,
        c.cuota AS monto_cuota,
        COALESCE(m.monto_mora, 0) AS monto_mora,
        c.asesor_id,
        a.nombre AS asesor,
        (
          CASE
            WHEN c."statusCredit" IN ${ESTADOS_SIN_MORA} THEN 0
            ELSE (
              SELECT COUNT(*)
              FROM ${SQL_CARTERA_SCHEMA}.cuotas_credito v
              WHERE v.credito_id = c.credito_id
                AND ${cuotaVencidaALaFecha("v", f)}
            )
          END
        )::int AS cuotas_vencidas,
        (
          SELECT MIN(v.fecha_vencimiento)::date
          FROM ${SQL_CARTERA_SCHEMA}.cuotas_credito v
          WHERE v.credito_id = c.credito_id
            AND ${cuotaVencidaALaFecha("v", f)}
        ) AS cuota_vencida_mas_vieja
      FROM ${SQL_CARTERA_SCHEMA}.creditos c
      INNER JOIN ${SQL_CARTERA_SCHEMA}.usuarios u ON u.usuario_id = c.usuario_id
      LEFT JOIN ${SQL_CARTERA_SCHEMA}.asesores a ON a.asesor_id = c.asesor_id
      LEFT JOIN ${SQL_CARTERA_SCHEMA}.moras_credito m
        ON m.credito_id = c.credito_id AND m.activa = true
      WHERE c."statusCredit" NOT IN (${fueraSql})
    ),
    criticos AS (
      SELECT
        base.*,
        (cuotas_vencidas * monto_cuota + monto_mora) AS monto_adeudado,
        COALESCE((${f} - cuota_vencida_mas_vieja), 0)::int AS dias_mora
      FROM base
      WHERE bucket IS NOT NULL
        AND cuotas_vencidas > 0
    ),
    ranked AS (
      SELECT
        criticos.*,
        COUNT(*) OVER (PARTITION BY bucket)::int AS total_criticos,
        ROW_NUMBER() OVER (
          PARTITION BY bucket
          ORDER BY monto_adeudado DESC, cuotas_vencidas DESC, credito_id ASC
        )::int AS rn
      FROM criticos
    )
    SELECT
      credito_id, numero_credito_sifco, cliente, bucket, status_credito,
      cuotas_vencidas,
      ROUND(monto_cuota::numeric, 2)::text AS monto_cuota,
      ROUND(monto_mora::numeric, 2)::text AS monto_mora,
      ROUND(monto_adeudado::numeric, 2)::text AS monto_adeudado,
      dias_mora, asesor_id, asesor, total_criticos, rn
    FROM ranked
    WHERE rn <= 3
    ORDER BY bucket, rn
  `);

  // Agrupar filas por bucket (ya vienen ordenadas bucket, rn).
  const porBucket = new Map<number, Top3Bucket>();
  for (const r of res.rows) {
    const bucket = Number(r.bucket);
    let grupo = porBucket.get(bucket);
    if (!grupo) {
      grupo = { bucket, total_criticos: Number(r.total_criticos), peor_monto: 0, top: [] };
      porBucket.set(bucket, grupo);
    }
    const fila: Top3Fila = {
      credito_id: Number(r.credito_id),
      numero_credito_sifco: r.numero_credito_sifco,
      cliente: r.cliente,
      bucket,
      status_credito: r.status_credito,
      cuotas_vencidas: Number(r.cuotas_vencidas),
      monto_cuota: Number(r.monto_cuota),
      monto_mora: Number(r.monto_mora),
      monto_adeudado: Number(r.monto_adeudado),
      dias_mora: Number(r.dias_mora),
      asesor_id: r.asesor_id != null ? Number(r.asesor_id) : null,
      asesor: r.asesor,
    };
    grupo.top.push(fila);
    if (fila.monto_adeudado > grupo.peor_monto) grupo.peor_monto = fila.monto_adeudado;
  }
  return [...porBucket.values()].sort((a, b) => a.bucket - b.bucket);
}

/** Bloque 2: cumplimiento del día ANTERIOR (cuotas que vencían `fecha - 1`). */
async function getCumplimientoAyer(fecha?: string): Promise<Cumplimiento> {
  const f = fechaSql(fecha);
  const fueraSql = sql.join(STATUS_BUCKET_FUERA.map((s) => sql`${s}`), sql`, `);
  const res = await db.execute<{
    fecha_ayer: string;
    cuentas_esperadas: number;
    cuentas_pagadas: number;
    monto_esperado: string;
    monto_pagado: string;
  }>(sql`
    WITH cuotas_ayer AS (
      SELECT
        cu.cuota_id,
        c.cuota AS monto_cuota,
        (
          EXISTS (${pagoCubriente(sql.raw("cu.cuota_id"), f)})
          OR (cu.pagado = true AND NOT EXISTS (${pagoCubriente(sql.raw("cu.cuota_id"))}))
        ) AS pagada
      FROM ${SQL_CARTERA_SCHEMA}.cuotas_credito cu
      INNER JOIN ${SQL_CARTERA_SCHEMA}.creditos c ON c.credito_id = cu.credito_id
      WHERE cu.fecha_vencimiento::date = (${f} - INTERVAL '1 day')::date
        AND c."statusCredit" NOT IN (${fueraSql})
    )
    SELECT
      (${f} - INTERVAL '1 day')::date::text AS fecha_ayer,
      COUNT(*)::int AS cuentas_esperadas,
      COUNT(*) FILTER (WHERE pagada)::int AS cuentas_pagadas,
      ROUND(COALESCE(SUM(monto_cuota), 0)::numeric, 2)::text AS monto_esperado,
      ROUND(COALESCE(SUM(monto_cuota) FILTER (WHERE pagada), 0)::numeric, 2)::text AS monto_pagado
    FROM cuotas_ayer
  `);
  const row = res.rows[0];
  return resumirCumplimiento({
    fecha: row?.fecha_ayer ?? "",
    cuentas_esperadas: Number(row?.cuentas_esperadas ?? 0),
    cuentas_pagadas: Number(row?.cuentas_pagadas ?? 0),
    monto_esperado: Number(row?.monto_esperado ?? 0),
    monto_pagado: Number(row?.monto_pagado ?? 0),
  });
}

/**
 * Bloque 4: "asignación del día" — transiciones de HOY agrupadas por ASESOR
 * dueño del crédito y bucket destino. Responde "¿a quién le cayó trabajo
 * nuevo anoche?", que es lo que el supervisor necesita a las 8 AM.
 *
 * El asesor sale de `creditos.asesor_id` (dueño ACTUAL) y no de
 * `buckets_historial.asesor_id` — este último es atribución de quién GATILLÓ
 * la transición (el que registró el pago en una BAJADA), no quién se queda
 * con la cuenta. Para "a quién le cayó" manda el dueño actual.
 */
async function getAsignacionDia(fecha?: string): Promise<AsignacionDiaAsesor[]> {
  const f = fechaSql(fecha);
  const res = await db.execute<{
    asesor_id: number | null;
    asesor: string | null;
    desde: number | null;
    bucket: number;
    cantidad: number;
    buckets_pool: number[] | null;
  }>(sql`
    SELECT
      c.asesor_id,
      a.nombre AS asesor,
      h.bucket_anterior AS desde,
      h.bucket_nuevo AS bucket,
      COUNT(*)::int AS cantidad,
      -- Bucket(s) del pool del asesor (config estable, no movimiento de hoy).
      -- Subquery agregada: devuelve un array por asesor sin multiplicar filas
      -- como haría un JOIN a asesor_bucket.
      (SELECT ARRAY_AGG(ab.bucket ORDER BY ab.bucket)
         FROM ${SQL_CARTERA_SCHEMA}.asesor_bucket ab
        WHERE ab.asesor_id = c.asesor_id AND ab.activo = true) AS buckets_pool
    FROM ${SQL_CARTERA_SCHEMA}.buckets_historial h
    INNER JOIN ${SQL_CARTERA_SCHEMA}.creditos c ON c.credito_id = h.credito_id
    LEFT JOIN ${SQL_CARTERA_SCHEMA}.asesores a ON a.asesor_id = c.asesor_id
    -- Misma conversión de dos etapas que getCuentasNuevas (ver comentario allá).
    WHERE ${diaGTDe("h.fecha")}::date = ${f}
      AND h.tipo_evento IN ('SUBIDA', 'BAJADA')
      -- Solo ENTRADAS al bucket que el asesor atiende: el movimiento tiene que
      -- ATERRIZAR en su pool. Una cuenta que se le fue (p.ej. atiende B4 y el
      -- crédito pasó B4→B5) ya no es trabajo suyo hoy — la recibe el asesor de
      -- B5, y aparece en la fila de ese. Sin este filtro la tabla mezclaba lo
      -- que le llegó con lo que se le fue.
      AND EXISTS (
        SELECT 1 FROM ${SQL_CARTERA_SCHEMA}.asesor_bucket ab
        WHERE ab.asesor_id = c.asesor_id
          AND ab.activo = true
          AND ab.bucket = h.bucket_nuevo
      )
    -- Sin tipo_evento en el GROUP BY: subidas y bajadas al MISMO bucket desde
    -- el MISMO origen se cuentan juntas — para quien recibe, ambas son un
    -- ingreso.
    GROUP BY c.asesor_id, a.nombre, h.bucket_anterior, h.bucket_nuevo
    -- El origen que más aportó primero.
    ORDER BY a.nombre NULLS LAST, COUNT(*) DESC, h.bucket_anterior
  `);

  // Agrupar por asesor (las filas vienen por asesor+bucket).
  const porAsesor = new Map<number | null, AsignacionDiaAsesor>();
  for (const r of res.rows) {
    const asesorId = r.asesor_id != null ? Number(r.asesor_id) : null;
    let grupo = porAsesor.get(asesorId);
    if (!grupo) {
      grupo = {
        asesor_id: asesorId,
        asesor: r.asesor,
        ingresos: 0,
        buckets_pool: (r.buckets_pool ?? []).map(Number),
        porBucket: [],
      };
      porAsesor.set(asesorId, grupo);
    }
    const cantidad = Number(r.cantidad);
    grupo.porBucket.push({
      desde: r.desde != null ? Number(r.desde) : null,
      bucket: Number(r.bucket),
      cantidad,
    });
    grupo.ingresos += cantidad;
  }
  // Más ingresos primero (a quién le cayó más trabajo hoy); desempate por
  // bucket atendido descendente — el asesor del bucket más alto gestiona la
  // mora más vieja — y luego por nombre, para que el orden sea estable.
  return [...porAsesor.values()].sort((a, b) => {
    if (a.ingresos !== b.ingresos) return b.ingresos - a.ingresos;
    const ba = a.buckets_pool[0] ?? -1;
    const bb = b.buckets_pool[0] ?? -1;
    if (ba !== bb) return bb - ba;
    return (a.asesor ?? "").localeCompare(b.asesor ?? "");
  });
}

/**
 * Vista de apertura matutina: las 4 secciones que dependen de cartera-back
 * (cuentas nuevas por bucket, cumplimiento de ayer, top 3 por bucket y la
 * asignación del día por asesor).
 */
export async function getAperturaDia(params: { fecha?: string } = {}): Promise<AperturaDiaResultado> {
  const [cuentas_nuevas, top3, cumplimiento, asignacion, movimientos] =
    await Promise.all([
      getCuentasNuevas(params.fecha),
      getTop3PorBucket(params.fecha),
      getCumplimientoAyer(params.fecha),
      getAsignacionDia(params.fecha),
      getMovimientosDia(params.fecha),
    ]);
  const fecha =
    params.fecha ??
    new Date().toLocaleDateString("sv-SE", { timeZone: "America/Guatemala" });

  return { fecha, cuentas_nuevas, cumplimiento, top3, asignacion, movimientos };
}
