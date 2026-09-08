import { createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../database";
import { SQL_CARTERA_SCHEMA as schema } from "../../database/db/schema";
import { bucketActualSql, STATUS_READER_FUERA } from "../../lib/buckets-classification";
import {
  BUCKETS_CONVENIO_LOCK_KEY,
  CREDITO_ASESOR_LOCK_NAMESPACE,
  PROCESAR_MORAS_LOCK_KEY,
} from "../../lib/buckets-job-locks";
import { previsualizarTrasladoCartera } from "../../lib/plan-traslado-cartera";

export const solicitudTrasladoSchema = z.object({
  asesorOrigenId: z.number().int().positive(),
  asesorDestinoId: z.number().int().positive().optional(),
  asesorDestinoEspecialId: z.number().int().positive().optional(),
  destinosPorBucket: z.record(z.string().regex(/^\d+$/), z.number().int().positive()).optional(),
  modo: z.enum(["traslado_completo", "redistribucion", "destino_por_bucket"]),
  motivo: z.string().trim().min(1).max(1000),
  actorEmail: z.string().email(),
}).superRefine((v, ctx) => {
  if (v.modo === "traslado_completo" && (!v.asesorDestinoId || v.asesorDestinoId === v.asesorOrigenId)) ctx.addIssue({ code: "custom", message: "Selecciona un destino distinto del origen" });
  if (v.modo === "redistribucion" && v.asesorDestinoId) ctx.addIssue({ code: "custom", message: "La redistribución usa todos los receptores elegibles" });
  if (v.modo === "destino_por_bucket" && (!v.destinosPorBucket || !Object.keys(v.destinosPorBucket).length)) ctx.addIssue({ code: "custom", message: "Selecciona un destino para cada bucket" });
  if (v.modo === "destino_por_bucket" && v.asesorDestinoId) ctx.addIssue({ code: "custom", message: "El destino por bucket no usa un asesor único" });
  if (v.asesorDestinoEspecialId === v.asesorOrigenId) ctx.addIssue({ code: "custom", message: "El destino de cuentas especiales debe ser distinto del origen" });
});
type Entrada = z.infer<typeof solicitudTrasladoSchema>;
type Executor = Pick<typeof db, "execute">;
type Credito = { credito_id: number; sifco: string; cliente: string | null; asesor_id: number | null; bucket: number | null; compromiso: boolean; especial: boolean; estado: string };
type Pool = { bucket: number; asesor_id: number; nombre: string; capacidad_base: number };

async function construirPlan(executor: Executor, entrada: Entrada) {
  const fuera = sql.join(STATUS_READER_FUERA.map((estado) => sql`${estado}`), sql`, `);
  // Todos los dueños: la carga de receptores no se calcula solo con origen.
  const creditos = (await executor.execute<Credito>(sql`
    SELECT c.credito_id, c.numero_credito_sifco AS sifco, u.nombre AS cliente, c.asesor_id, c."statusCredit" AS estado,
      CASE WHEN c."statusCredit" IN (${fuera}) THEN NULL ELSE ${bucketActualSql("c", "m")} END AS bucket,
      -- MISMA lista que anula el bucket, arriba. Antes esta condición añadía
      -- INCOBRABLE por su cuenta, pero INCOBRABLE no está fuera del funnel:
      -- el motor le fuerza bucket B5 (ver bucketDeCredito) y se cobra como
      -- cualquier otra cuenta. Marcarlo "especial" lo sacaba del reparto por
      -- pool, no lo contaba para capacidad y lo escribía en el historial con
      -- bucket NULL — corrompiendo la auditoría y el cálculo de carga justo en
      -- la baja de un asesor, que es el caso de uso principal.
      c."statusCredit" IN (${fuera}) AS especial,
      EXISTS (SELECT 1 FROM ${schema}.promesas_pago_espejo p WHERE p.credito_id = c.credito_id
        AND p.activa AND p.fecha_promesa >= (now() AT TIME ZONE 'America/Guatemala')::date) AS compromiso
    FROM ${schema}.creditos c
    LEFT JOIN ${schema}.usuarios u ON u.usuario_id = c.usuario_id
    LEFT JOIN ${schema}.moras_credito m ON m.credito_id = c.credito_id AND m.activa
    ORDER BY c.credito_id
  `)).rows;
  const pool = (await executor.execute<Pool>(sql`
    SELECT ab.bucket, ab.asesor_id, a.nombre, ab.capacidad_base
    FROM ${schema}.asesor_bucket ab JOIN ${schema}.asesores a ON a.asesor_id = ab.asesor_id
    WHERE ab.activo AND a.activo ORDER BY ab.bucket, ab.asesor_id
  `)).rows;
  if (entrada.asesorDestinoEspecialId !== undefined && !pool.some((p) => p.asesor_id === entrada.asesorDestinoEspecialId)) {
    throw new TrasladoConflict("El destino de cuentas especiales debe ser un asesor activo del pool");
  }
  // Falla CERRADO ante cuentas fuera del funnel sin destino: sin esto,
  // `previsualizarTrasladoCartera` las manda a `excluidos` y el asesor de
  // origen —que puede estar siendo dado de baja— se queda como responsable de
  // sus CANCELADO/PENDIENTE_CANCELACION/CAIDO sin que nadie lo vea.
  //
  // "Fuera del funnel" = STATUS_READER_FUERA, la MISMA lista que anula el
  // bucket arriba. INCOBRABLE NO está: el motor le fuerza B5 y se reparte
  // como cartera normal.
  //
  // No se puede exigir por motivo: la UI colapsa la razón (despido/renuncia,
  // los casos donde SÍ pide el destino especial) a `motivo`, texto libre, y
  // acá ya no se distingue de una redistribución. Así que la condición es la
  // que el backend sí puede comprobar: si hay especiales que trasladar, hace
  // falta a quién dárselas.
  const especialesDelOrigen = creditos.filter(
    (c) => c.asesor_id === entrada.asesorOrigenId && c.especial,
  ).length;
  if (especialesDelOrigen > 0 && entrada.asesorDestinoEspecialId === undefined) {
    // Los estados salen de la constante, no enumerados a mano: escritos aparte,
    // el mensaje termina nombrando estados que ya no aplican (pasó con
    // INCOBRABLE al alinear `especial` con STATUS_READER_FUERA).
    throw new TrasladoConflict(
      `El asesor origen tiene ${especialesDelOrigen} cuenta(s) fuera del funnel (${STATUS_READER_FUERA.join(", ")}). Selecciona un responsable para ellas.`,
    );
  }
  const elegibles = new Map<number, number[]>();
  const carga = new Map<number, Map<number, number>>();
  for (const p of pool) elegibles.set(p.bucket, [...(elegibles.get(p.bucket) ?? []), p.asesor_id]);
  for (const c of creditos) {
    if (c.bucket === null || c.asesor_id === null) continue;
    const counts = carga.get(c.bucket) ?? new Map<number, number>();
    counts.set(c.asesor_id, (counts.get(c.asesor_id) ?? 0) + 1);
    carga.set(c.bucket, counts);
  }
  const plan = previsualizarTrasladoCartera({ ...entrada,
    destinosPorBucket: new Map(Object.entries(entrada.destinosPorBucket ?? {}).map(([bucket, asesorId]) => [Number(bucket), asesorId])),
    creditos: creditos.map(c => ({ creditoId: c.credito_id, asesorId: c.asesor_id, bucket: c.bucket, tieneCompromisoVigente: c.compromiso, esEspecial: c.especial })),
    poolPorBucket: elegibles, cargaPorBucket: carga });
  const porId = new Map(creditos.map(c => [c.credito_id, c]));
  const asignaciones = plan.asignaciones.map(a => {
    const credito = porId.get(a.creditoId)!;
    return {
      ...a,
      numeroCreditoSifco: credito.sifco,
		cliente: credito.cliente,
      ...(credito.especial ? { estadoEspecial: credito.estado } : {}),
    };
  });
  const excluidos = plan.excluidos.map(excluido => {
    const credito = porId.get(excluido.creditoId)!;
    return {
      ...excluido,
      numeroCreditoSifco: credito.sifco,
      cliente: credito.cliente,
      estado: credito.estado,
    };
  });
  const deltas = new Map<string, number>();
  for (const a of asignaciones) {
    if (a.bucket === null) continue;
    const origen = `${a.bucket}:${a.asesorAnteriorId}`, destino = `${a.bucket}:${a.asesorNuevoId}`;
    deltas.set(origen, (deltas.get(origen) ?? 0) - 1);
    deltas.set(destino, (deltas.get(destino) ?? 0) + 1);
  }
  return { ...plan, asignaciones, excluidos, carga: pool.map(p => {
    const antes = carga.get(p.bucket)?.get(p.asesor_id) ?? 0;
    return { asesorId: p.asesor_id, nombre: p.nombre, bucket: p.bucket, antes, despues: antes + (deltas.get(`${p.bucket}:${p.asesor_id}`) ?? 0), capacidad: p.capacidad_base };
  }) };
}

function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export class TrasladoConflict extends Error {}

// `lock_timeout` aborta la transacción con 55P03 cuando un job de bucket ya
// posee su advisory lock. No es un error interno: el usuario puede volver a
// intentar cuando termine esa corrida. Drizzle conserva el código de PG en el
// error o en su causa según el driver usado.
function esTimeoutDeLock(error: unknown): boolean {
  let actual = error as { code?: string; cause?: unknown } | undefined;
  while (actual) {
    if (actual.code === "55P03") return true;
    actual = actual.cause as { code?: string; cause?: unknown } | undefined;
  }
  return false;
}

async function bloquearCreditosAsesor(
  tx: Executor,
  creditoIds: number[],
) {
  const ids = [...new Set(creditoIds)].sort((a, b) => a - b);
  if (!ids.length) return;
  // CTE materializada y ordenada: dos traslados que comparten créditos adquieren los
  // locks en mismo orden y no forman ciclo. pg_advisory_xact_lock se libera al
  // terminar esta transacción; los endpoints individuales usan misma llave.
  await tx.execute(sql`
    WITH creditos_ordenados AS MATERIALIZED (
      SELECT value::integer AS credito_id
      FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)
      ORDER BY value::integer
    )
    SELECT pg_advisory_xact_lock(${CREDITO_ASESOR_LOCK_NAMESPACE}, credito_id)
    FROM creditos_ordenados
  `);
}

/**
 * `actorEmail` llega en el CUERPO de la petición, no del token: el CRM
 * autentica con una credencial de SERVICIO compartida, así que el `user` del
 * middleware es la integración, no el supervisor que apretó el botón. Ese
 * campo es el único rastro de quién ordenó la operación — gobierna el dueño de
 * la previsualización, el `usuario_id` de `credito_asesor_historial` y el texto
 * de auditoría.
 *
 * Sin comprobarlo, cualquiera que alcance el endpoint con el token de servicio
 * podía atribuir una reasignación masiva a un correo arbitrario, incluido uno
 * inexistente: el `usuario_id` del historial sale de un SELECT sobre
 * platform_users que, sin match, se guardaba NULL EN SILENCIO — la operación
 * quedaba sin responsable y nadie se enteraba.
 *
 * Esto NO impide que un usuario legítimo mande el correo de un colega (el
 * token no distingue personas); para eso haría falta propagar identidad de
 * usuario desde el CRM. Lo que sí garantiza es que el responsable registrado
 * existe, está activo y es resoluble — la auditoría deja de poder quedar vacía.
 */
async function exigirActorRegistrado(executor: Executor, actorEmail: string) {
  const encontrado = (await executor.execute<{ id: number }>(sql`
    SELECT id FROM ${schema}.platform_users
    WHERE lower(email) = lower(${actorEmail}) AND is_active LIMIT 1
  `)).rows[0];
  if (!encontrado) {
    throw new TrasladoConflict("El usuario que ejecuta la operación no está registrado o está inactivo");
  }
}

export async function previsualizarTrasladoCarteraMasivo(raw: unknown) {
  const entrada = solicitudTrasladoSchema.parse(raw);
  await exigirActorRegistrado(db, entrada.actorEmail);
  const plan = await construirPlan(db, entrada);
  const previewId = crypto.randomUUID(), venceEn = new Date(Date.now() + 10 * 60_000).toISOString();
  const preview = { ...plan, previewId, venceEn };
  await db.execute(sql`INSERT INTO ${schema}.operaciones_traslado_cartera
    (id, payload_hash, modo, motivo, asesor_origen_id, actor_email, solicitud, preview, vence_en)
    VALUES (${previewId}::uuid, ${hash(plan)}, ${entrada.modo}, ${entrada.motivo}, ${entrada.asesorOrigenId},
      ${entrada.actorEmail}, ${JSON.stringify(entrada)}::jsonb, ${JSON.stringify(preview)}::jsonb, ${venceEn}::timestamptz)`);
  return preview;
}

export async function confirmarTrasladoCarteraMasivo(raw: unknown) {
  const input = z.object({ previewId: z.string().uuid(), idempotencyKey: z.string().uuid(), actorEmail: z.string().email() }).parse(raw);
  try {
    return await db.transaction(async tx => {
    const row = (await tx.execute<{ id: string; estado: string; idempotency_key: string | null; payload_hash: string; actor_email: string; solicitud: Entrada; preview: Awaited<ReturnType<typeof previsualizarTrasladoCarteraMasivo>>; vence_en: Date }>(sql`
      SELECT * FROM ${schema}.operaciones_traslado_cartera WHERE id = ${input.previewId}::uuid FOR UPDATE
    `)).rows[0];
    if (!row || row.actor_email !== input.actorEmail) throw new TrasladoConflict("Previsualización no encontrada para este usuario");
    if (row.estado === "confirmada") {
      if (row.idempotency_key !== input.idempotencyKey) throw new TrasladoConflict("La operación ya fue confirmada con otra solicitud");
      return { success: true as const, operacionId: row.id, cuentas: row.preview.asignaciones.length };
    }
    // Solo una confirmación NUEVA escribe historial. Un replay idempotente no
    // debe depender de que el actor siga activo después de su operación.
    await exigirActorRegistrado(tx, input.actorEmail);
    if (new Date(row.vence_en).getTime() <= Date.now()) throw new TrasladoConflict("La previsualización venció. Vuelve a previsualizar.");
    // Locks cortos durante revalidación y escritura; ninguna llamada HTTP en transacción.
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    // Los jobs de mora y convenio calculan su reasignación desde una foto de
    // dueño previa. Sin sus mismos locks, un job que ya leyó podía esperar este
    // `LOCK TABLE`, reanudar al confirmar y volver a escribir el asesor viejo.
    // Tomarlos antes de la foto y de las escrituras hace que una confirmación
    // espere al job en curso; mientras confirma, la siguiente corrida se omite.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${PROCESAR_MORAS_LOCK_KEY})`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${BUCKETS_CONVENIO_LOCK_KEY})`);
    // Primera foto descubre qué créditos hay que proteger. Tras tomar sus
    // locks se lee de nuevo: un editor que ya estaba en curso termina antes y
    // el hash obliga a generar un preview nuevo, en vez de mezclar ambas fotos.
    let plan = await construirPlan(tx, row.solicitud);
    await bloquearCreditosAsesor(tx, plan.asignaciones.map((a) => a.creditoId));
    plan = await construirPlan(tx, row.solicitud);
    if (hash(plan) !== row.payload_hash) throw new TrasladoConflict("La cartera cambió. Vuelve a previsualizar antes de confirmar.");
    if (plan.excluidos.length) {
      throw new TrasladoConflict(
        `Hay ${plan.excluidos.length} crédito(s) activos sin bucket operativo. Asigna su bucket antes de confirmar el traslado.`,
      );
    }
    if (plan.bloqueos.length || !plan.asignaciones.length) throw new TrasladoConflict("No hay un reparto completo disponible para confirmar");
    // Un solo CTE mantiene UPDATE, historial y detalle atómicos. El CAS por
    // fila preserva la protección frente a reasignaciones manuales; si una
    // sola fila cambió, se lanza conflicto y la transacción revierte lote
    // completo. Sin LOCK TABLE: crédito ajeno puede seguir escribiéndose.
    const detalles = plan.asignaciones.map((a) => ({
      credito_id: a.creditoId,
      asesor_anterior_id: a.asesorAnteriorId,
      asesor_nuevo_id: a.asesorNuevoId,
      bucket: a.bucket,
      prioridad: a.prioridad,
    }));
    const escrito = await tx.execute<{
      actualizados: number;
      historiales: number;
      detalles: number;
    }>(sql`
      WITH asignaciones AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(detalles)}::jsonb)
          AS a(credito_id integer, asesor_anterior_id integer, asesor_nuevo_id integer, bucket integer, prioridad integer)
      ), actualizados AS (
        UPDATE ${schema}.creditos c SET asesor_id = a.asesor_nuevo_id
        FROM asignaciones a
        WHERE c.credito_id = a.credito_id
          AND c.asesor_id IS NOT DISTINCT FROM a.asesor_anterior_id
        RETURNING c.credito_id, a.asesor_anterior_id, a.asesor_nuevo_id, a.bucket, a.prioridad
      ), historiales AS (
        INSERT INTO ${schema}.credito_asesor_historial
          (credito_id, asesor_anterior, asesor_nuevo, bucket, origen, motivo, usuario_id)
        SELECT credito_id, asesor_anterior_id, asesor_nuevo_id, bucket, 'API_MANUAL',
          ${`${row.solicitud.motivo} · Operación ${row.id} · ${input.actorEmail}`},
          (SELECT id FROM ${schema}.platform_users WHERE lower(email) = lower(${input.actorEmail}) LIMIT 1)
        FROM actualizados
        RETURNING credito_id
      ), detalles_insertados AS (
        INSERT INTO ${schema}.operaciones_traslado_cartera_detalle
          (operacion_id, credito_id, asesor_anterior_id, asesor_nuevo_id, bucket, prioridad)
        SELECT ${row.id}::uuid, credito_id, asesor_anterior_id, asesor_nuevo_id, bucket, prioridad
        FROM actualizados
        RETURNING credito_id
      )
      SELECT
        (SELECT count(*)::int FROM actualizados) AS actualizados,
        (SELECT count(*)::int FROM historiales) AS historiales,
        (SELECT count(*)::int FROM detalles_insertados) AS detalles
    `);
    const esperados = plan.asignaciones.length;
    const conteos = escrito.rows[0];
    if (!conteos || conteos.actualizados !== esperados || conteos.historiales !== esperados || conteos.detalles !== esperados) {
      throw new TrasladoConflict("El propietario cambió durante la operación");
    }
    // `idempotency_key` es UNIQUE global: la misma clave reusada contra OTRA
    // previsualización choca acá. Sin mapearlo, la violación sube cruda,
    // esquiva el 409 del router y sale como 500 a mitad de transacción —
    // justo el caso que la idempotencia debía volver predecible.
    try {
      await tx.execute(sql`UPDATE ${schema}.operaciones_traslado_cartera SET estado = 'confirmada', idempotency_key = ${input.idempotencyKey}
        WHERE id = ${row.id}::uuid`);
    } catch (error) {
      if ((error as { code?: string })?.code === "23505") {
        throw new TrasladoConflict("Esa clave de idempotencia ya se usó en otra operación");
      }
      throw error;
    }
    return { success: true as const, operacionId: row.id, cuentas: plan.asignaciones.length };
    });
  } catch (error) {
    if (esTimeoutDeLock(error)) {
      throw new TrasladoConflict("Otra operación de buckets está en curso. Intenta de nuevo en unos segundos.");
    }
    throw error;
  }
}

export async function listarTrasladosCartera(page: number) {
  return (await db.execute<{ id: string; modo: string; motivo: string; asesor_origen_id: number; actor_email: string; created_at: string; cuentas: number }>(sql`
    SELECT id, modo, motivo, asesor_origen_id, actor_email, created_at,
      jsonb_array_length(preview->'asignaciones') AS cuentas
    FROM ${schema}.operaciones_traslado_cartera WHERE estado = 'confirmada'
    ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET ${(page - 1) * 20}
  `)).rows;
}
