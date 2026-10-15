import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../database";
import { asesor_bucket, asesores, SQL_CARTERA_SCHEMA as schema } from "../../database/db/schema";
import { bucketActualSql, STATUS_READER_FUERA } from "../../lib/buckets-classification";
import { BUCKETS_CONVENIO_LOCK_KEY, CREDITO_ASESOR_LOCK_NAMESPACE, PROCESAR_MORAS_LOCK_KEY } from "../../lib/buckets-job-locks";
import { clasificarDevolucion, separarYaDevueltos, type UltimoCambioDueno } from "../../lib/ausencia-devolucion";
import { leerCreditos, reasignarAsesorLote } from "./reasignarAsesorLote";

// ─────────────────────────────────────────────────────────────────────────────
// COBROS-02 · M5 (issue #1895) — Ausencia indefinida de un asesor.
//
// El CRM reparte su cartera con un traslado `redistribucion` y, mientras dura la
// ausencia, lo saca del pool de asignación para que el motor no le mande
// cuentas nuevas. Al reactivarlo se vuelve a poner en el pool y se le devuelve
// lo que se repartió, salvo lo que ya cambió de manos o de bucket.
// ─────────────────────────────────────────────────────────────────────────────

export class AusenciaError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "AusenciaError";
  }
}

const MAX_LOTE = 200;

/**
 * Devuelve al asesor a los buckets que se le pausaron y, si el traslado que lo
 * pausó también lo sacó del balanceo de créditos nuevos, lo vuelve a poner. Es el
 * ÚLTIMO paso de la reactivación (la devolución de cuentas se hace con el pool
 * todavía pausado) y va en UNA transacción: o queda reanudado por completo o no.
 * Es idempotente, así que repetirlo tras una respuesta perdida es inocuo.
 */
export async function reanudarPoolAsesor(
  asesorId: number,
  buckets: number[],
  operacionId?: string,
): Promise<{ asesor_id: number; buckets: number[] }> {
  return db.transaction(async (tx) => {
    // El asesor se revisa AQUÍ, con lock: si se desactivó después de la última tanda
    // de la devolución, no se le reactiva el balanceo ni el pool (quedaría un asesor
    // inactivo con su configuración encendida, listo para recibir cuentas si se
    // vuelve a activar). La ausencia queda abierta y se repite cuando esté activo.
    const [asesor] = (
      await tx.execute<{ activo: boolean }>(sql`
        SELECT activo FROM ${schema}.asesores WHERE asesor_id = ${asesorId} FOR SHARE`)
    ).rows;
    if (!asesor?.activo) {
      throw new AusenciaError("El asesor no está activo: no se reanuda su pool.", 409, "asesor_inactivo");
    }
    if (operacionId) {
      await tx.execute(sql`
        UPDATE ${schema}.asesores SET activo_para_creditos = true
        WHERE asesor_id = ${asesorId}
          AND EXISTS (
            SELECT 1 FROM ${schema}.operaciones_traslado_cartera
            WHERE id = ${operacionId}::uuid AND asesor_origen_id = ${asesorId}
              AND solicitud->>'creditosPausados' = 'true')`);
      // La ausencia terminó: el asesor ya no figura como ausente para las asignaciones.
      await tx.execute(sql`
        UPDATE ${schema}.operaciones_traslado_cartera
        SET solicitud = solicitud || '{"ausente": false}'::jsonb
        WHERE id = ${operacionId}::uuid AND asesor_origen_id = ${asesorId}`);
    }
    if (buckets.length === 0) return { asesor_id: asesorId, buckets: [] };
    const filas = await tx
      .update(asesor_bucket)
      .set({ activo: true })
      .where(and(eq(asesor_bucket.asesor_id, asesorId), inArray(asesor_bucket.bucket, buckets)))
      .returning({ bucket: asesor_bucket.bucket });
    return { asesor_id: asesorId, buckets: filas.map((f) => f.bucket).sort((a, b) => a - b) };
  });
}

export type DetalleTraslado = {
  credito_id: number;
  asesor_anterior_id: number | null;
  asesor_nuevo_id: number;
  bucket: number | null;
};

/** Qué cuentas movió un traslado confirmado y a quién. */
export async function detalleTraslado(operacionId: string): Promise<DetalleTraslado[]> {
  const [op] = (
    await db.execute<{ estado: string }>(sql`
      SELECT estado FROM ${schema}.operaciones_traslado_cartera WHERE id = ${operacionId}::uuid`)
  ).rows;
  if (!op) throw new AusenciaError("El traslado no existe.", 404, "traslado_no_existe");
  if (op.estado !== "confirmada") {
    throw new AusenciaError("El traslado no está confirmado.", 409, "traslado_no_confirmado");
  }
  return (
    await db.execute<DetalleTraslado>(sql`
      SELECT credito_id, asesor_anterior_id, asesor_nuevo_id, bucket
      FROM ${schema}.operaciones_traslado_cartera_detalle
      WHERE operacion_id = ${operacionId}::uuid
      ORDER BY credito_id`)
  ).rows;
}

/**
 * Devuelve al asesor original lo que un traslado le repartió al equipo. Solo
 * vuelve una cuenta si SIGUE con quien la recibió y su bucket de hoy está en el
 * pool del asesor: si el motor o un supervisor ya la movió, se queda donde está.
 * Hay que reanudar el pool ANTES (la reasignación en bloque exige que el destino
 * esté activo en el bucket). Por tandas de 200, todo o nada cada una.
 */
export async function devolverTraslado(params: {
  operacionId: string;
  motivo: string;
  usuarioEmail?: string;
}) {
  const detalle = await detalleTraslado(params.operacionId);
  const [origen] = (
    await db.execute<{ asesor_origen_id: number; es_ausencia: boolean }>(sql`
      SELECT asesor_origen_id,
        -- La baja de un asesor también pausa el pool, pero es definitiva: no se devuelve.
        (COALESCE(solicitud->>'pausarPoolOrigen' = 'true', false)
          AND COALESCE(solicitud->>'desactivarOrigen', 'false') <> 'true') AS es_ausencia
      FROM ${schema}.operaciones_traslado_cartera WHERE id = ${params.operacionId}::uuid`)
  ).rows;
  // Solo se devuelve el reparto de una ausencia (el traslado que pausó el pool): un
  // traslado normal es una decisión permanente y esta ruta no debe deshacerla.
  if (!origen.es_ausencia) {
    throw new AusenciaError("Este traslado no es el reparto de una ausencia: no se puede devolver.", 409, "traslado_no_es_ausencia");
  }
  const titular = Number(origen.asesor_origen_id);
  // Un asesor desactivado durante la ausencia no recibe su cartera de vuelta: se
  // rechaza ANTES de mover nada (el lote lo vuelve a comprobar bajo sus locks).
  const [titularActual] = (
    await db.execute<{ activo: boolean }>(sql`SELECT activo FROM ${schema}.asesores WHERE asesor_id = ${titular}`)
  ).rows;
  if (!titularActual?.activo) {
    throw new AusenciaError("El asesor no está activo: no se le puede devolver su cartera.", 409, "asesor_inactivo");
  }

  const actuales = new Map<number, { asesor_id: number | null; bucket: number | null } | null>();
  const ids = detalle.map((d) => d.credito_id);
  for (let i = 0; i < ids.length; i += 500) {
    for (const [id, valor] of await leerCreditos(db, ids.slice(i, i + 500))) actuales.set(id, valor);
  }
  // El pool del titular sigue PAUSADO durante la devolución: sus buckets son los que
  // se le pausaron (guardados en la operación) más los que tenga activos hoy.
  const [opSolicitud] = (
    await db.execute<{ buckets: number[] | null }>(sql`
      SELECT CASE WHEN jsonb_typeof(solicitud->'bucketsPausados') = 'array'
        THEN ARRAY(SELECT jsonb_array_elements_text(solicitud->'bucketsPausados')::int) END AS buckets
      FROM ${schema}.operaciones_traslado_cartera WHERE id = ${params.operacionId}::uuid`)
  ).rows;
  const bucketsDelTitular = new Set<number>([
    ...(opSolicitud?.buckets ?? []).map(Number),
    ...(
      await db
        .select({ bucket: asesor_bucket.bucket })
        .from(asesor_bucket)
        .where(and(eq(asesor_bucket.asesor_id, titular), eq(asesor_bucket.activo, true)))
    ).map((b) => b.bucket),
  ]);

  const clasificacion = clasificarDevolucion(detalle, actuales, bucketsDelTitular);
  const { aDevolver, aDevolverDirecto } = clasificacion;
  const recibio = new Map(detalle.map((d) => [d.credito_id, d.asesor_nuevo_id]));
  // La bitácora de esta devolución lleva siempre la misma marca, derivada de la
  // operación (no del texto que mande el llamador, que puede cambiar entre intentos):
  // así un reintento reconoce lo que una tanda anterior ya regresó.
  const marca = ` · Devolución de la operación ${params.operacionId}`;
  const motivo = `${params.motivo}${marca}`;

  const { yaDevueltos, retenidos: retenidosSinRepetidos } = separarYaDevueltos(
    clasificacion.retenidos,
    detalle,
    actuales,
    await ultimosCambiosDeDueno(
      clasificacion.retenidos
        .filter((r) => r.motivo === "cambio_de_dueno" && actuales.get(r.credito_id)?.asesor_id === titular)
        .map((r) => r.credito_id),
    ),
    titular,
    marca,
  );
  const retenidos = [...retenidosSinRepetidos];
  let devueltos = yaDevueltos.length;
  let intentadas = 0;

  // Lo que cambió de dueño DESPUÉS de clasificar puede ser lo que otra reactivación
  // simultánea acaba de devolver: se resuelve al final mirando la marca en la bitácora.
  const cambiaronDeDueno: number[] = [];

  const devolverPorLotes = async (todas: number[]) => {
    intentadas += todas.length;
    for (let i = 0; i < todas.length; i += MAX_LOTE) {
      const lote = todas.slice(i, i + MAX_LOTE);
      const res = await reasignarAsesorLote({
        credito_ids: lote,
        asesor_nuevo_id: titular,
        motivo,
        usuario_email: params.usuarioEmail,
        // El pool del titular sigue pausado hasta el final: la elegibilidad ya la
        // decidió la clasificación (bucket de hoy dentro de sus buckets).
        buckets_pool_validados: bucketsDelTitular,
        // Bajo los locks del lote: si un supervisor la movió después de clasificar,
        // se queda con su nuevo dueño.
        duenios_esperados: new Map(lote.map((id) => [id, recibio.get(id) as number])),
      });
      if (!res.success) {
        // Lo devuelto en tandas anteriores ya está escrito; el supervisor puede
        // reintentar y solo se intentará lo que siga con quien lo recibió.
        throw new AusenciaError(
          `${res.message} (ya se devolvieron ${devueltos} de ${intentadas} cuentas; puede reintentar)`,
          res.status,
          "devolucion_parcial",
        );
      }
      devueltos += res.reasignados.length;
      for (const o of res.omitidos) {
        if (o.motivo === "cambio_de_dueno") cambiaronDeDueno.push(o.credito_id);
        // Cambió a un bucket fuera del pool del titular bajo los locks del lote.
        if (o.motivo === "bucket_fuera_del_pool") {
          retenidos.push({ credito_id: o.credito_id, motivo: "bucket_fuera_del_pool" });
        }
      }
    }
  };

  await devolverPorLotes(aDevolver);
  if (aDevolverDirecto.length) {
    const directos = await devolverSinBucket({
      operacionId: params.operacionId,
      titular,
      bucketsDelTitular,
      creditoIds: aDevolverDirecto,
      motivo,
      usuarioEmail: params.usuarioEmail,
    });
    devueltos += directos.devueltos.length;
    // Con bucket sembrado (convenio) que el titular no cubre: se quedan y se informan.
    for (const id of directos.fueraDelPool) retenidos.push({ credito_id: id, motivo: "bucket_fuera_del_pool" });
    const resueltosDirecto = new Set([...directos.devueltos, ...directos.fueraDelPool]);
    const omitidos = aDevolverDirecto.filter((id) => !resueltosDirecto.has(id));
    if (omitidos.length) {
      // Los que no se escribieron (cambiaron de dueño, se cerraron o ENTRARON a un
      // bucket mientras tanto) se vuelven a clasificar con lo que hay ahora: los que
      // siguen con quien los recibió y ya tienen bucket en el pool pasan por la
      // reasignación en bloque, que exige pool.
      const ahora = new Map<number, { asesor_id: number | null; bucket: number | null; cerrado?: boolean } | null>();
      for (const [id, valor] of await leerCreditos(db, omitidos)) ahora.set(id, valor);
      const nueva = clasificarDevolucion(
        detalle.filter((d) => omitidos.includes(d.credito_id)),
        ahora,
        bucketsDelTitular,
      );
      await devolverPorLotes(nueva.aDevolver);
      // Un `cambio_de_dueno` aquí puede ser lo que otra reactivación acaba de devolver:
      // se resuelve con la marca de la bitácora como el resto de las omisiones.
      for (const r of nueva.retenidos) {
        if (r.motivo === "cambio_de_dueno") cambiaronDeDueno.push(r.credito_id);
        else retenidos.push(r);
      }
      // Siguen sin bucket y con quien los recibió pero la escritura no los tomó.
      cambiaronDeDueno.push(...nueva.aDevolverDirecto);
    }
  }
  if (cambiaronDeDueno.length) {
    const unicos = [...new Set(cambiaronDeDueno)];
    const ahora = new Map<number, { asesor_id: number | null; bucket: number | null; cerrado?: boolean } | null>();
    for (const [id, valor] of await leerCreditos(db, unicos)) ahora.set(id, valor);
    const resueltos = separarYaDevueltos(
      unicos.map((id) => ({ credito_id: id, motivo: "cambio_de_dueno" as const })),
      detalle,
      ahora,
      await ultimosCambiosDeDueno(unicos.filter((id) => ahora.get(id)?.asesor_id === titular)),
      titular,
      marca,
    );
    devueltos += resueltos.yaDevueltos.length;
    retenidos.push(...resueltos.retenidos);
  }
  return { asesor_id: titular, devueltos, retenidos, total: detalle.length };
}

/** Último cambio de dueño de cada crédito en la bitácora (para reconocer lo ya devuelto). */
async function ultimosCambiosDeDueno(ids: number[]): Promise<Map<number, UltimoCambioDueno>> {
  const mapa = new Map<number, UltimoCambioDueno>();
  for (let i = 0; i < ids.length; i += 500) {
    const idsSql = sql.join(ids.slice(i, i + 500).map((id) => sql`${id}`), sql`, `);
    const res = await db.execute<{ credito_id: number } & UltimoCambioDueno>(sql`
      SELECT DISTINCT ON (credito_id) credito_id, asesor_anterior, asesor_nuevo, motivo
      FROM ${schema}.credito_asesor_historial
      WHERE credito_id IN (${idsSql})
      ORDER BY credito_id, historial_id DESC`);
    for (const f of res.rows) {
      mapa.set(Number(f.credito_id), {
        asesor_anterior: f.asesor_anterior === null ? null : Number(f.asesor_anterior),
        asesor_nuevo: f.asesor_nuevo === null ? null : Number(f.asesor_nuevo),
        motivo: f.motivo,
      });
    }
  }
  return mapa;
}

/**
 * Devuelve cuentas que estaban en el funnel al repartir pero hoy no tienen
 * bucket operativo (p. ej. EN_CONVENIO): la reasignación en bloque exige un
 * bucket para validar el pool, así que se escribe aparte, con el mismo cuidado:
 * sin esperar los locks de los jobs de moras y convenios, lock por crédito en
 * orden de id, compare-and-swap sobre quien lo recibió y bitácora API_MANUAL.
 */
async function devolverSinBucket(params: {
  operacionId: string;
  titular: number;
  /** Buckets que el titular cubre (pausados al repartir + activos hoy). */
  bucketsDelTitular: ReadonlySet<number>;
  creditoIds: number[];
  motivo: string;
  usuarioEmail?: string;
}): Promise<{ devueltos: number[]; fueraDelPool: number[] }> {
  const ids = [...new Set(params.creditoIds)].sort((a, b) => a - b);
  return db.transaction(async (tx) => {
    const jobs = await tx.execute<{ moras: boolean; convenio: boolean }>(sql`
      SELECT pg_try_advisory_xact_lock(${PROCESAR_MORAS_LOCK_KEY}) AS moras,
             pg_try_advisory_xact_lock(${BUCKETS_CONVENIO_LOCK_KEY}) AS convenio`);
    if (!jobs.rows?.[0]?.moras || !jobs.rows?.[0]?.convenio) {
      throw new AusenciaError(
        "Hay un proceso de buckets trabajando sobre la cartera en este momento. Intente de nuevo en unos minutos.",
        409,
        "buckets_ocupado",
      );
    }
    // FOR SHARE: desactivar al asesor espera a esta devolución, o esta ve que ya
    // no está activo y se aborta; sin el lock podía devolverle todo después.
    const [destino] = (
      await tx.execute<{ activo: boolean }>(sql`
        SELECT activo FROM ${schema}.asesores WHERE asesor_id = ${params.titular} FOR SHARE`)
    ).rows;
    if (!destino?.activo) throw new AusenciaError("El asesor no está activo.", 409, "asesor_inactivo");
    for (const id of ids) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${CREDITO_ASESOR_LOCK_NAMESPACE}, ${id})`);
    }
    const idsSql = sql.join(ids.map((id) => sql`${id}`), sql`, `);
    const cerradoSql = sql.join(STATUS_READER_FUERA.map((s) => sql`${s}`), sql`, `);
    // Una cuenta EN_CONVENIO no tiene bucket para el motor, pero el job de convenios
    // le siembra uno y ese es el que cuenta para el pool: se lee con la regla de
    // lectura (`bucketActualSql`, sin anular EN_CONVENIO). Si ese bucket no lo cubre
    // el titular, la cuenta se queda con quien la recibió y se informa.
    const bucketsSql = params.bucketsDelTitular.size
      ? sql.join([...params.bucketsDelTitular].map((b) => sql`${b}`), sql`, `)
      : sql`-1`;
    const fuera = await tx.execute<{ credito_id: number }>(sql`
      SELECT c.credito_id
      FROM ${schema}.creditos c
      JOIN ${schema}.operaciones_traslado_cartera_detalle d
        ON d.credito_id = c.credito_id AND d.operacion_id = ${params.operacionId}::uuid
      LEFT JOIN ${schema}.moras_credito m ON m.credito_id = c.credito_id AND m.activa
      WHERE c.credito_id IN (${idsSql}) AND c.asesor_id = d.asesor_nuevo_id
        AND COALESCE(c."statusCredit", '') NOT IN (${cerradoSql})
        AND ${bucketActualSql("c", "m")} IS NOT NULL
        AND ${bucketActualSql("c", "m")} NOT IN (${bucketsSql})`);
    const fueraDelPool = fuera.rows.map((r) => Number(r.credito_id));
    const fueraSet = sql.join(fueraDelPool.length ? fueraDelPool.map((id) => sql`${id}`) : [sql`-1`], sql`, `);
    const res = await tx.execute<{ credito_id: number; asesor_anterior: number; bucket: number | null }>(sql`
      WITH previos AS (
        -- El bucket de la bitácora es el de ESTE momento (como en la reasignación en
        -- bloque), no el que la cuenta tenía cuando se repartió.
        SELECT c.credito_id, c.asesor_id AS asesor_anterior, ${bucketActualSql("c", "m")} AS bucket
        FROM ${schema}.creditos c
        JOIN ${schema}.operaciones_traslado_cartera_detalle d
          ON d.credito_id = c.credito_id AND d.operacion_id = ${params.operacionId}::uuid
        LEFT JOIN ${schema}.moras_credito m ON m.credito_id = c.credito_id AND m.activa
        WHERE c.credito_id IN (${idsSql}) AND c.asesor_id = d.asesor_nuevo_id
          AND COALESCE(c."statusCredit", '') NOT IN (${cerradoSql})
          -- Sigue sin bucket operativo bajo los locks: si entró a uno, la regla del
          -- pool la aplica la reasignación en bloque (el reintento lo reclasifica).
          AND c.credito_id NOT IN (${fueraSet})
        FOR UPDATE OF c
      ), actualizados AS (
        UPDATE ${schema}.creditos c SET asesor_id = ${params.titular}
        FROM previos p WHERE c.credito_id = p.credito_id
        RETURNING c.credito_id, p.asesor_anterior, p.bucket
      ), historial AS (
        INSERT INTO ${schema}.credito_asesor_historial
          (credito_id, asesor_anterior, asesor_nuevo, bucket, origen, motivo, usuario_id)
        SELECT credito_id, asesor_anterior, ${params.titular}, bucket, 'API_MANUAL', ${params.motivo},
          (SELECT id FROM ${schema}.platform_users WHERE lower(email) = lower(${params.usuarioEmail ?? ""}) LIMIT 1)
        FROM actualizados
        RETURNING credito_id
      )
      SELECT credito_id, asesor_anterior, bucket FROM actualizados`);
    return { devueltos: res.rows.map((r) => Number(r.credito_id)), fueraDelPool };
  });
}
