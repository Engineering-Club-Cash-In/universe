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
  /** COBROS-02 M5: reparte por utilización (carga ÷ capacidad) en vez de por conteo. */
  ponderarPorCapacidad: z.boolean().optional(),
  /**
   * COBROS-02 M5: las cuentas fuera del funnel (CANCELADO, CAIDO…) se quedan con
   * el asesor de origen y no exigen un destino especial. Es para ausencias
   * temporales: esas cuentas no se gestionan y no hay nada que repartir.
   */
  mantenerEspeciales: z.boolean().optional(),
  /**
   * COBROS-02 M5: al confirmar, el asesor de origen sale de su pool EN LA MISMA
   * transacción que el traslado (sin ventana en la que el motor le asigne cuentas
   * que el traslado no vio). Los buckets pausados quedan en la operación y se
   * devuelven también en un replay idempotente.
   */
  pausarPoolOrigen: z.boolean().optional(),
  /**
   * COBROS-02 · Baja de asesor: al confirmar, el asesor de origen queda
   * DESACTIVADO (asesores.activo = false, fuera del balanceo y de su pool, login
   * de cartera inactivo) en la MISMA transacción que reparte su cartera. Exige
   * `pausarPoolOrigen` (sin ventana en la que el motor le asigne cuentas) y no
   * admite `mantenerEspeciales`: en una baja no se queda ninguna cuenta con él.
   */
  desactivarOrigen: z.boolean().optional(),
  actorEmail: z.string().email(),
}).superRefine((v, ctx) => {
  if (v.desactivarOrigen && !v.pausarPoolOrigen) ctx.addIssue({ code: "custom", message: "La baja del asesor requiere sacarlo de su pool (pausarPoolOrigen)" });
  if (v.desactivarOrigen && v.mantenerEspeciales) ctx.addIssue({ code: "custom", message: "En una baja ninguna cuenta se queda con el asesor: indique el responsable de las cuentas fuera del funnel" });
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
  if (especialesDelOrigen > 0 && entrada.asesorDestinoEspecialId === undefined && !entrada.mantenerEspeciales) {
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
  const capacidad = new Map<number, Map<number, number>>();
  for (const p of pool) {
    const porAsesor = capacidad.get(p.bucket) ?? new Map<number, number>();
    porAsesor.set(p.asesor_id, Number(p.capacidad_base));
    capacidad.set(p.bucket, porAsesor);
  }
  const plan = previsualizarTrasladoCartera({ ...entrada, capacidadPorBucket: capacidad,
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
      estadoActual: credito.estado,
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

async function bloquearFilasMora(
  tx: Executor,
  creditoIds: number[],
) {
  const ids = [...new Set(creditoIds)].sort((a, b) => a - b);
  if (!ids.length) return;
  // Se toma DESPUÉS de la fila de `creditos` (regla de candados del módulo
  // de mora: crédito → mora). Si una edición ya cambió cuotas_atrasadas,
  // termina antes y la foto final invalida el preview; si no, espera al lote.
  await tx.execute(sql`
    WITH creditos_ordenados AS MATERIALIZED (
      SELECT value::integer AS credito_id
      FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)
      ORDER BY value::integer
    )
    SELECT m.mora_id
    FROM creditos_ordenados ids
    JOIN ${schema}.moras_credito m ON m.credito_id = ids.credito_id AND m.activa
    ORDER BY ids.credito_id
    FOR UPDATE OF m
  `);
}

async function bloquearFilasCredito(
  tx: Executor,
  creditoIds: number[],
) {
  const ids = [...new Set(creditoIds)].sort((a, b) => a - b);
  if (!ids.length) return;
  // Un escritor de mora bloquea esta misma fila antes de cambiar cuotas y
  // estado. Así no puede quedar una mora sin confirmar entre la foto final y
  // el UPDATE del traslado. Mismo orden por ID que el advisory lock anterior.
  await tx.execute(sql`
    WITH creditos_ordenados AS MATERIALIZED (
      SELECT value::integer AS credito_id
      FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)
      ORDER BY value::integer
    )
    SELECT c.credito_id
    FROM creditos_ordenados ids
    JOIN ${schema}.creditos c ON c.credito_id = ids.credito_id
    ORDER BY c.credito_id
    FOR UPDATE OF c
  `);
}

async function bloquearDestinos(
  tx: Executor,
  asesorIds: number[],
) {
  const ids = [...new Set(asesorIds)].sort((a, b) => a - b);
  if (!ids.length) return;
  // updateAdvisor toma un lock de escritura sobre asesores y los cambios de
  // pool lo toman sobre asesor_bucket. Este lock conserva ambos hasta
  // confirmar, para que ninguna baja invalide el plan final.
  await tx.execute(sql`
    WITH destinos_ordenados AS MATERIALIZED (
      SELECT value::integer AS asesor_id
      FROM jsonb_array_elements_text(${JSON.stringify(ids)}::jsonb)
      ORDER BY value::integer
    )
    SELECT a.asesor_id
    FROM destinos_ordenados d
    JOIN ${schema}.asesores a ON a.asesor_id = d.asesor_id
    JOIN ${schema}.asesor_bucket pool ON pool.asesor_id = a.asesor_id
    ORDER BY a.asesor_id, pool.id
    FOR SHARE OF a, pool
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
export async function exigirActorRegistrado(executor: Executor, actorEmail: string) {
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
  const input = z.object({ previewId: z.string().uuid(), idempotencyKey: z.string().uuid(), actorEmail: z.string().email(), asesorOrigenId: z.number().int().positive().optional(), pausarPoolOrigen: z.boolean().optional(), desactivarOrigen: z.boolean().optional(), motivo: z.string().min(1).max(1000).optional() }).parse(raw);
  try {
    return await db.transaction(async tx => {
    const row = (await tx.execute<{ id: string; estado: string; motivo: string; idempotency_key: string | null; payload_hash: string; actor_email: string; solicitud: Entrada & { bucketsPausados?: number[] }; preview: Awaited<ReturnType<typeof previsualizarTrasladoCarteraMasivo>>; vence_en: Date }>(sql`
      SELECT * FROM ${schema}.operaciones_traslado_cartera WHERE id = ${input.previewId}::uuid FOR UPDATE
    `)).rows[0];
    if (!row || row.actor_email !== input.actorEmail) throw new TrasladoConflict("Previsualización no encontrada para este usuario");
    // El llamador declara a qué asesor y con qué opciones previsualizó: una
    // previsualización de otro asesor no se confirma bajo este.
    if (input.asesorOrigenId !== undefined && row.solicitud.asesorOrigenId !== input.asesorOrigenId) {
      throw new TrasladoConflict("La previsualización no corresponde a este asesor");
    }
    // Mismo motivo que se previsualizó: la bitácora de cartera y la del llamador no se contradicen.
    if (input.motivo !== undefined && row.motivo !== input.motivo) {
      throw new TrasladoConflict("El motivo no coincide con el de la previsualización");
    }
    if (input.pausarPoolOrigen && !row.solicitud.pausarPoolOrigen) {
      throw new TrasladoConflict("La previsualización no incluye la pausa del pool");
    }
    // La baja va en las dos direcciones: no se da de baja con una previsualización
    // que no la incluye, ni se confirma una baja por la ruta de un traslado normal
    // (quien la confirma debe saber que el asesor queda desactivado).
    if (!!input.desactivarOrigen !== !!row.solicitud.desactivarOrigen) {
      throw new TrasladoConflict(
        row.solicitud.desactivarOrigen
          ? "Esta previsualización es la baja de un asesor: confírmela desde «Dar de baja»"
          : "La previsualización no incluye la baja del asesor",
      );
    }
    if (row.estado === "confirmada") {
      if (row.idempotency_key !== input.idempotencyKey) throw new TrasladoConflict("La operación ya fue confirmada con otra solicitud");
      return {
        success: true as const,
        operacionId: row.id,
        cuentas: row.preview.asignaciones.length,
        ...(row.solicitud.pausarPoolOrigen ? { bucketsPausados: row.solicitud.bucketsPausados ?? [] } : {}),
        ...(row.solicitud.desactivarOrigen ? { desactivado: true as const } : {}),
      };
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
    // Pausa del pool del origen: su lock de escritura se toma ANTES de las fotos del
    // plan. Quien asigna a este asesor revalida su pertenencia al pool bajo un lock
    // compartido sobre esas filas, así que o confirma antes de la foto o espera a
    // que la pausa termine y se rechaza. El lock global evita que dos pausas se
    // crucen con los pools de la otra como destinos.
    let creditosPausados = false;
    if (row.solicitud.pausarPoolOrigen) {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('traslado-pausa-pool'))`);
      await tx.execute(sql`SELECT id FROM ${schema}.asesor_bucket
        WHERE asesor_id = ${row.solicitud.asesorOrigenId} ORDER BY id FOR UPDATE`);
      // Sale del balanceo de créditos nuevos ANTES de las fotos: el UPDATE retiene el
      // lock de la fila hasta el commit, y quien asigna un crédito nuevo lo valida
      // con un lock compartido sobre esa fila (createCredit), así que o su crédito
      // ya está confirmado cuando se toma la foto o la asignación se rechaza y
      // elige a otro asesor.
      // Una ausencia no se confirma sobre un asesor desactivado: la reactivación no
      // podría devolverle la cartera y quedaría abierta. Se lee bajo el mismo lock de
      // fila que retiene el UPDATE de abajo, así una desactivación concurrente o termina
      // antes y se rechaza acá, o espera a esta confirmación.
      const [origenFila] = (
        await tx.execute<{ activo: boolean }>(sql`
          SELECT activo FROM ${schema}.asesores WHERE asesor_id = ${row.solicitud.asesorOrigenId} FOR UPDATE`)
      ).rows;
      if (!origenFila?.activo) {
        throw new TrasladoConflict(
          row.solicitud.desactivarOrigen
            ? "El asesor ya está dado de baja."
            : "El asesor está desactivado: no se puede marcar ausente. Para repartir su cartera use un traslado.",
        );
      }
      const sinBalanceo = await tx.execute(sql`
        UPDATE ${schema}.asesores SET activo_para_creditos = false
        WHERE asesor_id = ${row.solicitud.asesorOrigenId} AND activo_para_creditos
        RETURNING asesor_id`);
      creditosPausados = sinBalanceo.rows.length > 0;
    }
    // Primera foto descubre qué créditos hay que proteger. Tras tomar sus
    // locks se lee de nuevo: un editor que ya estaba en curso termina antes y
    // el hash obliga a generar un preview nuevo, en vez de mezclar ambas fotos.
    let plan = await construirPlan(tx, row.solicitud);
    // Las cuentas EXCLUIDAS (las que se quedan con el asesor de origen) también se
    // bloquean: el chequeo final solo cuenta cuántas quedan en el origen, así que una
    // reactivación que las devolviera al funnel después de la última foto pasaría
    // inadvertida y dejaría una cuenta viva con el asesor pausado.
    const aProteger = [
      ...plan.asignaciones.map((a) => a.creditoId),
      ...plan.excluidos.map((e) => e.creditoId),
    ];
    await bloquearCreditosAsesor(tx, aProteger);
    // Orden del módulo de mora (develop, latefee.ts): `creditos` PRIMERO y
    // `moras_credito` después. Al revés, un traslado y un pago/convenio/cron
    // concurrentes se pedían los candados en cruz (40P01).
    await bloquearFilasCredito(tx, aProteger);
    await bloquearFilasMora(tx, plan.asignaciones.map((a) => a.creditoId));
    await bloquearDestinos(tx, plan.asignaciones.map((a) => a.asesorNuevoId));
    plan = await construirPlan(tx, row.solicitud);
    if (hash(plan) !== row.payload_hash) throw new TrasladoConflict("La cartera cambió. Vuelve a previsualizar antes de confirmar.");
    // Con `mantenerEspeciales` (ausencia temporal, M5) las cuentas fuera del funnel
    // se quedan con el asesor de origen a propósito: no se exige repartirlas.
    if (plan.excluidos.length && !row.solicitud.mantenerEspeciales) {
      throw new TrasladoConflict(
        `Hay ${plan.excluidos.length} crédito(s) activos sin bucket operativo. Asigna su bucket antes de confirmar el traslado.`,
      );
    }
    // Con `mantenerEspeciales` (ausencia, M5) un traslado sin cuentas que repartir es
    // válido: el asesor sin cartera operativa igual debe poder marcarse ausente.
    // En una baja tampoco: un asesor sin cartera igual se tiene que poder dar de baja.
    if (plan.bloqueos.length || (!plan.asignaciones.length && !row.solicitud.mantenerEspeciales && !row.solicitud.desactivarOrigen)) throw new TrasladoConflict("No hay un reparto completo disponible para confirmar");
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
      estado_anterior: a.estadoActual,
      compromiso_anterior: a.prioridad === 0,
    }));
    // Misma definición de bucket que construirPlan. Además del dueño y estado,
    // el lote debe seguir viendo el bucket que previsualizó: una edición manual
    // de cuotas_atrasadas puede mantener MOROSO pero mover B1 a B3.
    const fuera = sql.join(STATUS_READER_FUERA.map((estado) => sql`${estado}`), sql`, `);
    const escrito = await tx.execute<{
      actualizados: number;
      historiales: number;
      detalles: number;
      restantes_origen: number;
    }>(sql`
      WITH asignaciones AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(detalles)}::jsonb)
          AS a(credito_id integer, asesor_anterior_id integer, asesor_nuevo_id integer, bucket integer, prioridad integer, estado_anterior text, compromiso_anterior boolean)
      ), actualizados AS (
        UPDATE ${schema}.creditos c SET asesor_id = a.asesor_nuevo_id
        FROM asignaciones a
        LEFT JOIN ${schema}.moras_credito m ON m.credito_id = a.credito_id AND m.activa
        WHERE c.credito_id = a.credito_id
          AND c.asesor_id IS NOT DISTINCT FROM a.asesor_anterior_id
          AND c."statusCredit" IS NOT DISTINCT FROM a.estado_anterior
          AND (
            EXISTS (
              SELECT 1 FROM ${schema}.promesas_pago_espejo p
              WHERE p.credito_id = c.credito_id
                AND p.activa
                AND p.fecha_promesa >= (now() AT TIME ZONE 'America/Guatemala')::date
            )
          ) IS NOT DISTINCT FROM a.compromiso_anterior
          AND (
            CASE WHEN c."statusCredit" IN (${fuera}) THEN NULL
            ELSE ${bucketActualSql("c", "m")}
            END
          ) IS NOT DISTINCT FROM a.bucket
          AND EXISTS (
            SELECT 1
            FROM ${schema}.asesores destino
            JOIN ${schema}.asesor_bucket pool ON pool.asesor_id = destino.asesor_id
            WHERE destino.asesor_id = a.asesor_nuevo_id
              AND destino.activo
              AND pool.activo
              AND (a.bucket IS NULL OR pool.bucket = a.bucket)
          )
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
      ), restantes_origen AS (
        SELECT c.credito_id
        FROM ${schema}.creditos c
        WHERE c.asesor_id = ${row.solicitud.asesorOrigenId}
        EXCEPT
        SELECT credito_id FROM actualizados
      )
      SELECT
        (SELECT count(*)::int FROM actualizados) AS actualizados,
        (SELECT count(*)::int FROM historiales) AS historiales,
        (SELECT count(*)::int FROM detalles_insertados) AS detalles,
        (SELECT count(*)::int FROM restantes_origen) AS restantes_origen
    `);
    const esperados = plan.asignaciones.length;
    const conteos = escrito.rows[0];
    // Con `mantenerEspeciales` (M5) se quedan en el origen exactamente las cuentas excluidas.
    const restantesEsperados = row.solicitud.mantenerEspeciales ? plan.excluidos.length : 0;
    if (!conteos || conteos.actualizados !== esperados || conteos.historiales !== esperados || conteos.detalles !== esperados || conteos.restantes_origen !== restantesEsperados) {
      throw new TrasladoConflict("El propietario cambió durante la operación");
    }
    let bucketsPausados: number[] | undefined;
    if (row.solicitud.pausarPoolOrigen) {
      const pausados = await tx.execute<{ bucket: number }>(sql`
        UPDATE ${schema}.asesor_bucket SET activo = false
        WHERE asesor_id = ${row.solicitud.asesorOrigenId} AND activo
        RETURNING bucket`);
      bucketsPausados = pausados.rows.map((f) => Number(f.bucket)).sort((a, b) => a - b);
      // Baja: el asesor queda desactivado en ESTA transacción, con su cartera ya
      // repartida (el conteo de arriba exige que no le quede ningún crédito) y su
      // pool apagado. O todo o nada: nunca queda un asesor inactivo con cuentas, ni
      // uno sin cuentas que el motor pueda volver a llenar. La fila de `asesores` ya
      // está bloqueada (FOR UPDATE de la pausa). Su login de cartera (rol ASESOR)
      // también se apaga; la cuenta del CRM la deshabilita el CRM después.
      if (row.solicitud.desactivarOrigen) {
        await tx.execute(sql`UPDATE ${schema}.asesores
          SET activo = false, activo_para_creditos = false
          WHERE asesor_id = ${row.solicitud.asesorOrigenId}`);
        await tx.execute(sql`UPDATE ${schema}.platform_users SET is_active = false
          WHERE asesor_id = ${row.solicitud.asesorOrigenId} AND role = 'ASESOR' AND is_active`);
      }
      // `ausente` también en la baja: `validarAsesorExplicito` (createCredit) no le
      // asigna créditos nuevos a quien lo tiene. Un alta posterior lo apaga.
      await tx.execute(sql`UPDATE ${schema}.operaciones_traslado_cartera
        SET solicitud = solicitud || ${JSON.stringify({ bucketsPausados, creditosPausados, ausente: true, ...(row.solicitud.desactivarOrigen ? { desactivado: true } : {}) })}::jsonb
        WHERE id = ${row.id}::uuid`);
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
    return {
      success: true as const,
      operacionId: row.id,
      cuentas: plan.asignaciones.length,
      ...(bucketsPausados ? { bucketsPausados } : {}),
      ...(row.solicitud.desactivarOrigen ? { desactivado: true as const } : {}),
    };
    });
  } catch (error) {
    if (esTimeoutDeLock(error)) {
      throw new TrasladoConflict("Otra operación de buckets está en curso. Intenta de nuevo en unos segundos.");
    }
    throw error;
  }
}

/** M5 · la operación confirmada con esta clave de idempotencia, para reconciliar un registro pendiente. */
export async function consultarTrasladoPorClave(clave: string) {
  const fila = (await db.execute<{ id: string; cuentas: number; buckets: number[] | null; asesor_origen_id: number; es_ausencia: boolean }>(sql`
    SELECT id, jsonb_array_length(preview->'asignaciones') AS cuentas,
      asesor_origen_id,
      -- La baja también pausa el pool, pero no es una ausencia: no se reconcilia como tal.
      (COALESCE(solicitud->>'pausarPoolOrigen' = 'true', false)
        AND COALESCE(solicitud->>'desactivarOrigen', 'false') <> 'true') AS es_ausencia,
      CASE WHEN jsonb_typeof(solicitud->'bucketsPausados') = 'array'
        THEN ARRAY(SELECT jsonb_array_elements_text(solicitud->'bucketsPausados')::int) END AS buckets
    FROM ${schema}.operaciones_traslado_cartera
    WHERE idempotency_key = ${clave} AND estado = 'confirmada'`)).rows[0];
  return fila
    ? {
        operacionId: fila.id,
        cuentas: Number(fila.cuentas),
        bucketsPausados: fila.buckets ?? [],
        asesorOrigenId: Number(fila.asesor_origen_id),
        esAusencia: fila.es_ausencia,
      }
    : null;
}

export async function listarTrasladosCartera(page: number) {
  return (await db.execute<{ id: string; modo: string; motivo: string; asesor_origen_id: number; actor_email: string; created_at: string; cuentas: number }>(sql`
    SELECT id, modo, motivo, asesor_origen_id, actor_email, created_at,
      jsonb_array_length(preview->'asignaciones') AS cuentas
    FROM ${schema}.operaciones_traslado_cartera WHERE estado = 'confirmada'
    ORDER BY created_at DESC, id DESC LIMIT 20 OFFSET ${(page - 1) * 20}
  `)).rows;
}

/**
 * COBROS-02 M3 · traslados confirmados con paginación real, filtros de fecha y
 * total, para la bitácora del supervisor. `listarTrasladosCartera` queda igual
 * (20 por página, sin total) para el front existente. `desde` inclusivo y
 * `hasta` exclusivo (instantes ISO).
 */
export async function listarTrasladosCarteraPaginado(params: {
  page: number;
  perPage: number;
  desde?: Date | null;
  hasta?: Date | null;
}) {
  const perPage = Math.min(500, Math.max(1, params.perPage));
  const page = Math.max(1, params.page);
  const filtroDesde = params.desde ? sql`AND created_at >= ${params.desde.toISOString()}::timestamptz` : sql``;
  const filtroHasta = params.hasta ? sql`AND created_at < ${params.hasta.toISOString()}::timestamptz` : sql``;
  const [filas, conteo] = await Promise.all([
    db.execute<{ id: string; modo: string; motivo: string; asesor_origen_id: number; actor_email: string; created_at: string; cuentas: number }>(sql`
      SELECT id, modo, motivo, asesor_origen_id, actor_email, created_at,
        jsonb_array_length(preview->'asignaciones') AS cuentas
      FROM ${schema}.operaciones_traslado_cartera
      WHERE estado = 'confirmada' ${filtroDesde} ${filtroHasta}
      ORDER BY created_at DESC, id DESC LIMIT ${perPage} OFFSET ${(page - 1) * perPage}
    `),
    db.execute<{ total: number }>(sql`
      SELECT count(*)::int AS total FROM ${schema}.operaciones_traslado_cartera
      WHERE estado = 'confirmada' ${filtroDesde} ${filtroHasta}
    `),
  ]);
  const total = Number(conteo.rows[0]?.total ?? 0);
  return {
    data: filas.rows,
    pagination: { page, perPage, total, totalPages: Math.max(1, Math.ceil(total / perPage)) },
  };
}
