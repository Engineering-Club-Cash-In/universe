import { and, eq, sql } from "drizzle-orm";
import { db } from "../../database";
import {
  asesor_bucket,
  asesores,
  credito_asesor_historial,
  platform_users,
  SQL_CARTERA_SCHEMA,
} from "../../database/db/schema";
import { bucketActualSql, STATUS_BUCKET_FUERA } from "../../lib/buckets-classification";
import {
  BUCKETS_CONVENIO_LOCK_KEY,
  CREDITO_ASESOR_LOCK_NAMESPACE,
  PROCESAR_MORAS_LOCK_KEY,
} from "../../lib/buckets-job-locks";
import {
  type CreditoLoteLeido,
  type ErrorLote,
  evaluarLote,
  MAX_ID_INT4,
  normalizarCreditoIds,
} from "../../lib/buckets-reasignacion-lote";
import { getAsesoresPorBucket } from "./reasignarAsesor";

// ─────────────────────────────────────────────────────────────────────────────
// COBROS-02 · Buckets — Reasignación MANUAL EN BLOQUE (S6, issue #1891).
// Misma regla que `reasignarAsesorManual` (motivo obligatorio, asesor destino en
// el pool activo del bucket ACTUAL de cada crédito, bitácora API_MANUAL), pero
// TODO O NADA: se valida el lote completo antes de escribir y, si un solo
// crédito no cumple, no se toca ninguno. La escritura es una transacción con los
// locks por crédito tomados en orden de id (sin interbloqueo entre lotes) y un
// compare-and-swap sobre el dueño leído, igual que la reasignación individual.
// ─────────────────────────────────────────────────────────────────────────────

export type ReasignarLoteResultado =
  | {
      success: true;
      asesor_nuevo: number;
      reasignados: Array<{ credito_id: number; asesor_anterior: number | null; bucket: number }>;
      omitidos: Array<{ credito_id: number; motivo: "ya_asignado" }>;
    }
  | { success: false; status: number; message: string; errores?: ErrorLote[] };

class LoteEnConflicto extends Error {}
class BucketsOcupado extends Error {}

/** Presupuesto TOTAL de espera por locks de crédito y de elegibilidad. */
const PRESUPUESTO_LOCKS_MS = 5_000;

const MENSAJE_BUCKETS_OCUPADO =
  "[ERROR] Hay un proceso de buckets trabajando sobre la cartera en este momento (moras 00:05 / convenios 00:30). Intente de nuevo en unos minutos.";

/** Dueño y bucket actual de varios créditos en una sola consulta. */
async function leerCreditos(
  ejecutor: Pick<typeof db, "execute">,
  ids: number[],
): Promise<Map<number, CreditoLoteLeido | null>> {
  const fueraSql = sql.join(STATUS_BUCKET_FUERA.map((s) => sql`${s}`), sql`, `);
  const idsSql = sql.join(ids.map((id) => sql`${id}`), sql`, `);
  const res = await ejecutor.execute<{
    credito_id: number;
    asesor_id: number | null;
    fuera: boolean;
    bucket: number | null;
  }>(sql`
    SELECT
      c.credito_id,
      c.asesor_id,
      (c."statusCredit" IN (${fueraSql})) AS fuera,
      ${bucketActualSql("c", "m")} AS bucket
    FROM ${SQL_CARTERA_SCHEMA}.creditos c
    LEFT JOIN ${SQL_CARTERA_SCHEMA}.moras_credito m
      ON m.credito_id = c.credito_id AND m.activa = true
    WHERE c.credito_id IN (${idsSql})
  `);
  const mapa = new Map<number, CreditoLoteLeido | null>(ids.map((id) => [id, null]));
  for (const fila of res.rows ?? []) {
    mapa.set(Number(fila.credito_id), {
      asesor_id: fila.asesor_id === null ? null : Number(fila.asesor_id),
      bucket:
        fila.fuera || fila.bucket === null || fila.bucket === undefined
          ? null
          : Number(fila.bucket),
    });
  }
  return mapa;
}

export async function reasignarAsesorLote(params: {
  credito_ids: unknown;
  asesor_nuevo_id: number;
  motivo: string;
  usuario_email?: string;
}): Promise<ReasignarLoteResultado> {
  const motivo = (params.motivo ?? "").trim();
  if (!motivo) {
    return { success: false, status: 400, message: "[ERROR] El motivo es obligatorio" };
  }
  if (
    !Number.isInteger(params.asesor_nuevo_id) ||
    params.asesor_nuevo_id <= 0 ||
    params.asesor_nuevo_id > MAX_ID_INT4
  ) {
    return { success: false, status: 400, message: "[ERROR] asesor_nuevo_id inválido" };
  }
  const ids = normalizarCreditoIds(params.credito_ids);
  if (!ids) {
    return {
      success: false,
      status: 400,
      message: "[ERROR] credito_ids inválido (de 1 a 200 ids enteros positivos, hasta 2147483647)",
    };
  }

  // 1. Identidad del supervisor (best-effort, igual que la reasignación individual).
  let usuarioId: number | null = null;
  if (params.usuario_email) {
    const [u] = await db
      .select({ id: platform_users.id })
      .from(platform_users)
      .where(eq(platform_users.email, params.usuario_email));
    usuarioId = u?.id ?? null;
  }

  // 2. Todo dentro de UNA transacción: primero los locks de TODOS los créditos
  // pedidos (en orden de id, sin interbloqueo entre lotes) y recién entonces se
  // lee y valida el lote completo, de modo que lo validado es lo vigente al
  // escribir (dueño y bucket actuales, también de los que se omiten). Si algo no
  // cumple no se escribe nada.
  const ordenados = [...ids].sort((a, b) => a - b);
  try {
    const resultado = await db.transaction(async (tx) => {
      // Los jobs de moras y de convenios son los que cambian el bucket y el
      // dueño sin tomar los locks por crédito: se piden SIN ESPERAR (la misma
      // política que la recuperación de vehículo y Jurídico). Si alguno corre,
      // es mejor pedir que se reintente que validar contra un bucket que está
      // por cambiar; y mientras este lote los tiene, la corrida del job se omite.
      const jobs = await tx.execute<{ moras: boolean; convenio: boolean }>(sql`
        SELECT
          pg_try_advisory_xact_lock(${PROCESAR_MORAS_LOCK_KEY})   AS moras,
          pg_try_advisory_xact_lock(${BUCKETS_CONVENIO_LOCK_KEY}) AS convenio
      `);
      if (!jobs.rows?.[0]?.moras || !jobs.rows?.[0]?.convenio) {
        throw new BucketsOcupado();
      }
      // Espera acotada y COMPARTIDA por todos los locks de crédito y de la
      // elegibilidad del destino (un editor individual en curso): cada espera
      // usa lo que queda del presupuesto, no un tiempo propio. Mientras se
      // espera se sostienen los locks de moras y convenios.
      const vence = Date.now() + PRESUPUESTO_LOCKS_MS;
      const acotarEspera = async () => {
        const restante = vence - Date.now();
        if (restante <= 0) throw new BucketsOcupado();
        // lock_timeout aplica a cada fila bloqueada; statement_timeout acota la
        // sentencia completa (varias filas de pool incluidas) al mismo plazo.
        await tx.execute(
          sql`SELECT set_config('lock_timeout', ${`${restante}ms`}, true),
                     set_config('statement_timeout', ${`${restante}ms`}, true)`,
        );
      };
      const terminarEspera = async () => {
        await tx.execute(
          sql`SELECT set_config('lock_timeout', '0', true),
                     set_config('statement_timeout', '0', true)`,
        );
      };
      // Dueños ANTES de esperar los locks: lo que el lote "vio" al llegar. Si
      // otro lote o edición los cambia mientras se espera, este queda obsoleto y
      // se rechaza (409) en vez de tomar el dueño recién confirmado como esperado
      // y pisarlo.
      const dueniosPrevios = await leerCreditos(tx, ids);
      for (const creditoId of ordenados) {
        await acotarEspera();
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(${CREDITO_ASESOR_LOCK_NAMESPACE}, ${creditoId})`,
        );
      }
      // El destino y su pertenencia al pool se retienen hasta el commit
      // (FOR SHARE): desactivar al asesor o sacarlo del pool (UPDATE/DELETE)
      // espera a que este lote termine, así que la elegibilidad leída es la
      // que rige cuando se escribe.
      await acotarEspera();
      await tx
        .select({ asesor_id: asesores.asesor_id })
        .from(asesores)
        .where(eq(asesores.asesor_id, params.asesor_nuevo_id))
        .for("share");
      await acotarEspera();
      await tx
        .select({ asesor_id: asesor_bucket.asesor_id })
        .from(asesor_bucket)
        .where(
          and(
            eq(asesor_bucket.asesor_id, params.asesor_nuevo_id),
            eq(asesor_bucket.activo, true),
          ),
        )
        .for("share");
      // Lock de FILA de los créditos, en orden de id y dentro del mismo plazo:
      // quien cambia el estado (/creditAction: cancelado, incobrable...) no toma
      // los advisory locks pero sí actualiza esta fila, así que o confirma antes
      // de la relectura de abajo o espera a que termine el lote. Sin esto, el
      // bucket y el estado validados podían quedar viejos al escribir.
      await acotarEspera();
      await tx.execute(sql`
        SELECT credito_id FROM ${SQL_CARTERA_SCHEMA}.creditos
        WHERE credito_id IN (${sql.join(ordenados.map((id) => sql`${id}`), sql`, `)})
        ORDER BY credito_id
        FOR UPDATE
      `);
      // Terminada la fase de locks, el resto de la transacción ya no tiene tope.
      await terminarEspera();
      const creditos = await leerCreditos(tx, ids);
      for (const id of ids) {
        const antes = dueniosPrevios.get(id);
        const ahora = creditos.get(id);
        if (antes && ahora && antes.asesor_id !== ahora.asesor_id) {
          throw new LoteEnConflicto();
        }
      }
      const bucketsUsados = [
        ...new Set(
          [...creditos.values()].flatMap((c) =>
            c && c.bucket !== null ? [c.bucket] : [],
          ),
        ),
      ];
      const poolPorBucket = new Map<number, Set<number>>();
      for (const bucket of bucketsUsados) {
        const pool = await getAsesoresPorBucket(bucket, tx, true);
        poolPorBucket.set(bucket, new Set(pool.map((a) => a.asesor_id)));
      }
      const evaluacion = evaluarLote({
        creditoIds: ids,
        creditos,
        poolPorBucket,
        asesorNuevoId: params.asesor_nuevo_id,
      });
      if (evaluacion.errores.length > 0 || evaluacion.aReasignar.length === 0) {
        // Nada que escribir: o el lote no cumple, o todos ya eran del destino.
        return evaluacion;
      }
      const valores = sql.join(
        evaluacion.aReasignar.map(
          (a) => sql`(${a.credito_id}::int, ${a.asesor_anterior}::int)`,
        ),
        sql`, `,
      );
      // Compare-and-swap por crédito, por si el dueño cambió por una vía que no
      // toma este lock: se deshace TODO el lote.
      const actualizados = await tx.execute<{ credito_id: number }>(sql`
        UPDATE ${SQL_CARTERA_SCHEMA}.creditos AS c
        SET asesor_id = ${params.asesor_nuevo_id}
        FROM (VALUES ${valores}) AS v(credito_id, esperado)
        WHERE c.credito_id = v.credito_id
          AND c.asesor_id IS NOT DISTINCT FROM v.esperado
        RETURNING c.credito_id
      `);
      if ((actualizados.rows?.length ?? 0) !== evaluacion.aReasignar.length) {
        throw new LoteEnConflicto();
      }
      await tx.insert(credito_asesor_historial).values(
        evaluacion.aReasignar.map((a) => ({
          credito_id: a.credito_id,
          asesor_anterior: a.asesor_anterior,
          asesor_nuevo: params.asesor_nuevo_id,
          bucket: a.bucket,
          origen: "API_MANUAL" as const,
          motivo,
          usuario_id: usuarioId,
        })),
      );
      return evaluacion;
    });
    if (resultado.errores.length > 0) {
      return {
        success: false,
        status: 400,
        message: `[ERROR] No se reasignó ningún crédito: ${resultado.errores.length} del lote ${resultado.errores.length === 1 ? "no cumple" : "no cumplen"} las reglas.`,
        errores: resultado.errores,
      };
    }
    return {
      success: true,
      asesor_nuevo: params.asesor_nuevo_id,
      reasignados: resultado.aReasignar,
      omitidos: resultado.omitidos,
    };
  } catch (error) {
    const codigoPg = (error as { code?: string; cause?: { code?: string } })?.code
      ?? (error as { cause?: { code?: string } })?.cause?.code;
    // 55P03 = lock_not_available, 57014 = query_canceled (statement_timeout): venció
    // el presupuesto de espera de los locks.
    if (error instanceof BucketsOcupado || codigoPg === "55P03" || codigoPg === "57014") {
      return { success: false, status: 409, message: MENSAJE_BUCKETS_OCUPADO };
    }
    if (error instanceof LoteEnConflicto) {
      return {
        success: false,
        status: 409,
        message:
          "[ERROR] El asesor de algún crédito cambió durante la reasignación. No se reasignó ninguno: actualice la vista e intente de nuevo.",
      };
    }
    throw error;
  }
}
