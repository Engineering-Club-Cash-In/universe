import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../database";
import { asesor_bucket, asesores, SQL_CARTERA_SCHEMA as schema } from "../../database/db/schema";
import { bucketActualSql, STATUS_BUCKET_FUERA, STATUS_READER_FUERA } from "../../lib/buckets-classification";
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
 * Saca al asesor del pool de TODOS sus buckets y devuelve cuáles estaban
 * activos (solo esos se reactivan después: un bucket que un admin ya había
 * desactivado no se enciende solo).
 */
export async function pausarPoolAsesor(
  asesorId: number,
  operacionId?: string,
): Promise<{ asesor_id: number; buckets: number[] }> {
  const [asesor] = await db.select({ id: asesores.asesor_id }).from(asesores).where(eq(asesores.asesor_id, asesorId));
  if (!asesor) throw new AusenciaError("El asesor no existe.", 404, "asesor_no_existe");
  const filas = await db
    .update(asesor_bucket)
    .set({ activo: false })
    .where(and(eq(asesor_bucket.asesor_id, asesorId), eq(asesor_bucket.activo, true)))
    .returning({ bucket: asesor_bucket.bucket });
  if (operacionId) {
    // Compensación de una reactivación que falló: el asesor sigue ausente, así que
    // también vuelve a salir del balanceo de créditos nuevos.
    await db.execute(sql`
      UPDATE ${schema}.asesores SET activo_para_creditos = false
      WHERE asesor_id = ${asesorId}
        AND EXISTS (
          SELECT 1 FROM ${schema}.operaciones_traslado_cartera
          WHERE id = ${operacionId}::uuid AND asesor_origen_id = ${asesorId}
            AND solicitud->>'creditosPausados' = 'true')`);
    await marcarReanudada(asesorId, operacionId, false);
  }
  return { asesor_id: asesorId, buckets: filas.map((f) => f.bucket).sort((a, b) => a - b) };
}

/** Registra en la operación si el asesor está hoy reanudado (para saber si sigue ausente). */
async function marcarReanudada(asesorId: number, operacionId: string, reanudada: boolean) {
  await db.execute(sql`
    UPDATE ${schema}.operaciones_traslado_cartera
    SET solicitud = solicitud || ${JSON.stringify({ reanudada })}::jsonb
    WHERE id = ${operacionId}::uuid AND asesor_origen_id = ${asesorId}`);
}

/**
 * Devuelve al asesor a los buckets que se le pausaron y, si el traslado que lo
 * pausó también lo sacó del balanceo de créditos nuevos, lo vuelve a poner.
 */
export async function reanudarPoolAsesor(
  asesorId: number,
  buckets: number[],
  operacionId?: string,
): Promise<{ asesor_id: number; buckets: number[] }> {
  if (operacionId) {
    await db.execute(sql`
      UPDATE ${schema}.asesores SET activo_para_creditos = true
      WHERE asesor_id = ${asesorId}
        AND EXISTS (
          SELECT 1 FROM ${schema}.operaciones_traslado_cartera
          WHERE id = ${operacionId}::uuid AND asesor_origen_id = ${asesorId}
            AND solicitud->>'creditosPausados' = 'true')`);
    await marcarReanudada(asesorId, operacionId, true);
  }
  if (buckets.length === 0) return { asesor_id: asesorId, buckets: [] };
  const filas = await db
    .update(asesor_bucket)
    .set({ activo: true })
    .where(and(eq(asesor_bucket.asesor_id, asesorId), inArray(asesor_bucket.bucket, buckets)))
    .returning({ bucket: asesor_bucket.bucket });
  return { asesor_id: asesorId, buckets: filas.map((f) => f.bucket).sort((a, b) => a - b) };
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
    await db.execute<{ asesor_origen_id: number }>(sql`
      SELECT asesor_origen_id FROM ${schema}.operaciones_traslado_cartera WHERE id = ${params.operacionId}::uuid`)
  ).rows;
  const titular = Number(origen.asesor_origen_id);

  const actuales = new Map<number, { asesor_id: number | null; bucket: number | null } | null>();
  const ids = detalle.map((d) => d.credito_id);
  for (let i = 0; i < ids.length; i += 500) {
    for (const [id, valor] of await leerCreditos(db, ids.slice(i, i + 500))) actuales.set(id, valor);
  }
  const bucketsDelTitular = new Set(
    (
      await db
        .select({ bucket: asesor_bucket.bucket })
        .from(asesor_bucket)
        .where(and(eq(asesor_bucket.asesor_id, titular), eq(asesor_bucket.activo, true)))
    ).map((b) => b.bucket),
  );

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
      }
    }
  };

  await devolverPorLotes(aDevolver);
  if (aDevolverDirecto.length) {
    const directos = await devolverSinBucket({
      operacionId: params.operacionId,
      titular,
      creditoIds: aDevolverDirecto,
      motivo,
      usuarioEmail: params.usuarioEmail,
    });
    devueltos += directos.length;
    const devueltosDirecto = new Set(directos);
    const omitidos = aDevolverDirecto.filter((id) => !devueltosDirecto.has(id));
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
      retenidos.push(...nueva.retenidos);
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
  creditoIds: number[];
  motivo: string;
  usuarioEmail?: string;
}): Promise<number[]> {
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
    const [destino] = (
      await tx.execute<{ activo: boolean }>(sql`
        SELECT activo FROM ${schema}.asesores WHERE asesor_id = ${params.titular}`)
    ).rows;
    if (!destino?.activo) throw new AusenciaError("El asesor no está activo.", 409, "asesor_inactivo");
    for (const id of ids) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${CREDITO_ASESOR_LOCK_NAMESPACE}, ${id})`);
    }
    const idsSql = sql.join(ids.map((id) => sql`${id}`), sql`, `);
    const cerradoSql = sql.join(STATUS_READER_FUERA.map((s) => sql`${s}`), sql`, `);
    const fueraSql = sql.join(STATUS_BUCKET_FUERA.map((s) => sql`${s}`), sql`, `);
    const res = await tx.execute<{ credito_id: number; asesor_anterior: number; bucket: number | null }>(sql`
      WITH previos AS (
        SELECT c.credito_id, c.asesor_id AS asesor_anterior, d.bucket
        FROM ${schema}.creditos c
        JOIN ${schema}.operaciones_traslado_cartera_detalle d
          ON d.credito_id = c.credito_id AND d.operacion_id = ${params.operacionId}::uuid
        LEFT JOIN ${schema}.moras_credito m ON m.credito_id = c.credito_id AND m.activa
        WHERE c.credito_id IN (${idsSql}) AND c.asesor_id = d.asesor_nuevo_id
          AND COALESCE(c."statusCredit", '') NOT IN (${cerradoSql})
          -- Sigue sin bucket operativo bajo los locks: si entró a uno, la regla del
          -- pool la aplica la reasignación en bloque (el reintento lo reclasifica).
          AND (CASE WHEN c."statusCredit" IN (${fueraSql}) THEN NULL ELSE ${bucketActualSql("c", "m")} END) IS NULL
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
    return res.rows.map((r) => Number(r.credito_id));
  });
}
