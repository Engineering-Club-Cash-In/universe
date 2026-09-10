import { and, eq, sql } from "drizzle-orm";
import { db } from "../../database";
import {
  asesor_bucket,
  asesores,
  buckets,
  buckets_historial,
  credito_asesor_historial,
  creditos,
  platform_users,
  SQL_CARTERA_SCHEMA,
} from "../../database/db/schema";
import { bucketActualSql, STATUS_BUCKET_FUERA } from "../../lib/buckets-classification";
import { CREDITO_ASESOR_LOCK_NAMESPACE } from "../../lib/buckets-job-locks";
import { elegirAsesorParaBucket } from "../latefee";

// ─────────────────────────────────────────────────────────────────────────────
// COBROS-02 · Buckets — RECUPERACIÓN DE VEHÍCULO (traslado manual a B4).
//
// Es el ÚNICO escritor manual de `buckets_historial`: todo lo demás lo escribe
// el motor (latefee.ts) derivando el bucket de la mora. Acá la decisión NO sale
// de las cuotas atrasadas sino de una persona: se resolvió recuperar la unidad,
// así que la cuenta pasa a "Última Instancia / Pre Jurídico" sin importar en qué
// escalón de mora vaya.
//
// El traslado usa exactamente la misma mecánica que el motor para no abrir un
// segundo modelo: fila en `buckets_historial` (origen=API_MANUAL) + elección de
// asesor con `elegirAsesorParaBucket` (si el dueño actual ya cubre el bucket
// destino se queda; si no, el del pool con menos carga) + el par UPDATE
// creditos.asesor_id / INSERT credito_asesor_historial en una transacción.
//
// ⚠️ PENDIENTE CONOCIDO (docs/features/cobros-02/07-recuperacion-de-vehiculo.md):
// el traslado NO es permanente. El motor de las 23:59 GT vuelve
// a derivar el bucket de las cuotas atrasadas; un crédito con 2 cuotas que se
// mandó a B4 hoy amanece en B2 mañana, con su BAJADA registrada y reasignado.
// Falta la decisión de producto sobre cómo se ancla (estado del crédito, flag de
// congelado, o módulo que lo saque explícitamente). Este módulo hace el traslado
// y nada más — a propósito.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bucket destino de una recuperación de vehículo: B4 "Última Instancia / Pre
 * Jurídico". Es una constante y no un parámetro del request a propósito — este
 * endpoint NO es un "mover a cualquier bucket": esa sería una puerta para
 * romper la invariante de que el bucket lo deriva la mora. Se valida contra el
 * catálogo en cada llamada por si alguien desactiva o renumera el escalón.
 */
export const BUCKET_RECUPERACION_VEHICULO = 4;

export type RecuperacionVehiculoResultado =
  | {
      success: true;
      credito_id: number;
      bucket_anterior: number;
      bucket_nuevo: number;
      tipo_evento: "SUBIDA" | "BAJADA";
      asesor_anterior: number | null;
      asesor_nuevo: number | null;
      /** true si el dueño ya cubría B4 y por eso no cambió (misma regla del motor). */
      asesor_sin_cambio: boolean;
    }
  | { success: false; message: string; status?: number };

type EstadoCredito = {
  asesor_id: number | null;
  status_credito: string | null;
  cuotas_atrasadas: number;
  bucket_actual: number | null;
  fuera_del_funnel: boolean;
};

/**
 * Estado del crédito relevante para el traslado, en UNA query: dueño actual,
 * status, cuotas de la mora activa y bucket actual con la MISMA derivación que
 * usan el listado y la reasignación manual (bucketActualSql).
 */
async function getEstadoCredito(credito_id: number): Promise<EstadoCredito | null> {
  const fueraSql = sql.join(STATUS_BUCKET_FUERA.map((s) => sql`${s}`), sql`, `);
  const res = await db.execute<{
    asesor_id: number | null;
    status_credito: string | null;
    cuotas_atrasadas: number | null;
    bucket: number | null;
    fuera: boolean;
  }>(sql`
    SELECT
      c.asesor_id,
      c."statusCredit" AS status_credito,
      COALESCE(m.cuotas_atrasadas, 0) AS cuotas_atrasadas,
      (c."statusCredit" IN (${fueraSql})) AS fuera,
      ${bucketActualSql("c", "m")} AS bucket
    FROM ${SQL_CARTERA_SCHEMA}.creditos c
    LEFT JOIN ${SQL_CARTERA_SCHEMA}.moras_credito m
      ON m.credito_id = c.credito_id AND m.activa = true
    WHERE c.credito_id = ${credito_id}
    LIMIT 1
  `);
  const row = res.rows?.[0];
  if (!row) return null;
  return {
    asesor_id: row.asesor_id === null ? null : Number(row.asesor_id),
    status_credito: row.status_credito ?? null,
    cuotas_atrasadas: Number(row.cuotas_atrasadas ?? 0),
    bucket_actual: row.bucket === null || row.bucket === undefined ? null : Number(row.bucket),
    fuera_del_funnel: Boolean(row.fuera),
  };
}

/**
 * Carga viva del pool del bucket destino: cuántas cuentas lleva HOY cada asesor
 * en ese bucket, con la misma derivación de bucket actual que todo lo demás.
 * Alimenta el desempate por menor carga de `elegirAsesorParaBucket`.
 */
async function getCargaDelBucket(bucket: number): Promise<Map<number, number>> {
  const res = await db.execute<{ asesor_id: number; cuentas: number }>(sql`
    SELECT c.asesor_id, COUNT(*)::int AS cuentas
    FROM ${SQL_CARTERA_SCHEMA}.creditos c
    LEFT JOIN ${SQL_CARTERA_SCHEMA}.moras_credito m
      ON m.credito_id = c.credito_id AND m.activa = true
    WHERE c.asesor_id IS NOT NULL
      AND ${bucketActualSql("c", "m")} = ${bucket}
    GROUP BY c.asesor_id
  `);
  const carga = new Map<number, number>();
  for (const row of res.rows ?? []) {
    carga.set(Number(row.asesor_id), Number(row.cuentas));
  }
  return carga;
}

/**
 * Manda un crédito a recuperación de vehículo: lo traslada a B4 y lo reasigna
 * al asesor que cubre ese bucket. Motivo obligatorio (es una decisión humana y
 * la bitácora tiene que poder responder por qué).
 */
export async function enviarARecuperacionVehiculo(params: {
  credito_id: number;
  motivo: string;
  usuario_email?: string;
}): Promise<RecuperacionVehiculoResultado> {
  const { credito_id } = params;
  const motivo = (params.motivo ?? "").trim();
  const destino = BUCKET_RECUPERACION_VEHICULO;

  if (!motivo) {
    return { success: false, status: 400, message: "[ERROR] El motivo es obligatorio" };
  }

  // 1. El bucket destino tiene que existir y estar activo en el catálogo. Si
  //    alguien lo desactivó, es mejor reventar que sembrar una fila que apunta
  //    a un escalón que ya no se atiende.
  const [bucketDestino] = await db
    .select({ numero: buckets.numero, nombre: buckets.nombre })
    .from(buckets)
    .where(and(eq(buckets.numero, destino), eq(buckets.activo, true)));
  if (!bucketDestino) {
    return {
      success: false,
      status: 409,
      message: `[ERROR] El bucket B${destino} (recuperación de vehículo) no existe o está inactivo en el catálogo.`,
    };
  }

  // 2. Estado del crédito.
  const estado = await getEstadoCredito(credito_id);
  if (!estado) {
    return {
      success: false,
      status: 404,
      message: `[ERROR] No se encontró crédito con credito_id=${credito_id}`,
    };
  }
  if (estado.fuera_del_funnel) {
    return {
      success: false,
      status: 400,
      message: `[ERROR] El crédito está en estado ${estado.status_credito} (fuera del funnel operativo): no se traslada a recuperación.`,
    };
  }
  if (estado.bucket_actual === null) {
    return {
      success: false,
      status: 400,
      message: "[ERROR] El crédito no tiene bucket actual: no se puede registrar el traslado.",
    };
  }
  if (estado.bucket_actual === destino) {
    return {
      success: false,
      status: 400,
      message: `[ERROR] El crédito ya está en B${destino} (${bucketDestino.nombre}).`,
    };
  }

  const bucketAnterior = estado.bucket_actual;
  const tipoEvento: "SUBIDA" | "BAJADA" = destino > bucketAnterior ? "SUBIDA" : "BAJADA";

  // 3. Asesor destino con la MISMA regla del motor: si el dueño actual ya está
  //    en el pool de B4 se queda (sin churn); si no, el de menor carga.
  const poolRows = await db
    .select({ asesor_id: asesor_bucket.asesor_id })
    .from(asesor_bucket)
    .innerJoin(asesores, eq(asesores.asesor_id, asesor_bucket.asesor_id))
    .where(
      and(
        eq(asesor_bucket.bucket, destino),
        eq(asesor_bucket.activo, true),
        eq(asesores.activo, true),
      ),
    )
    .orderBy(asesor_bucket.asesor_id);
  const pool = poolRows.map((r) => r.asesor_id);
  if (pool.length === 0) {
    return {
      success: false,
      status: 409,
      message: `[ERROR] B${destino} no tiene asesores activos en su pool: el crédito quedaría sin dueño. Configurá el pool antes de mandar cuentas a recuperación.`,
    };
  }
  const asesorActual = estado.asesor_id;
  const asesorElegido = elegirAsesorParaBucket(
    pool,
    await getCargaDelBucket(destino),
    asesorActual,
  );
  const cambiaAsesor = asesorElegido !== null && asesorElegido !== asesorActual;

  // 4. Identidad de quien lo pidió (best-effort, mismo patrón que reasignarAsesor).
  let usuarioId: number | null = null;
  if (params.usuario_email) {
    const [u] = await db
      .select({ id: platform_users.id })
      .from(platform_users)
      .where(eq(platform_users.email, params.usuario_email));
    usuarioId = u?.id ?? null;
  }

  // `buckets_historial` no tiene columna usuario_id (el motor, su único escritor
  // hasta hoy, no la necesitaba). Mientras no exista, el actor va dentro del
  // motivo: sin esto, un traslado que no cambia de asesor no deja rastro de
  // QUIÉN lo pidió, porque el usuario_id vive en credito_asesor_historial.
  const actor = params.usuario_email?.trim();
  const motivoBucket = actor
    ? `Recuperación de vehículo (solicitada por ${actor}): ${motivo}`
    : `Recuperación de vehículo: ${motivo}`;

  // 5. Traslado + reasignación en UNA transacción, tomando el mismo advisory
  //    lock que el motor y el traslado masivo: si procesarMoras está corriendo
  //    sobre este crédito, se espera en vez de pisarse. El compare-and-swap del
  //    UPDATE protege además contra un cambio de dueño entre la lectura y la
  //    escritura.
  const resultado = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${CREDITO_ASESOR_LOCK_NAMESPACE}, ${credito_id})`,
    );

    await tx.insert(buckets_historial).values({
      credito_id,
      bucket_anterior: bucketAnterior,
      bucket_nuevo: destino,
      tipo_evento: tipoEvento,
      origen: "API_MANUAL",
      cuotas_atrasadas_nuevas: estado.cuotas_atrasadas,
      status_credito: estado.status_credito,
      motivo: motivoBucket,
    });

    if (!cambiaAsesor || asesorElegido === null) return true;

    const filas = await tx
      .update(creditos)
      .set({ asesor_id: asesorElegido })
      .where(
        and(
          eq(creditos.credito_id, credito_id),
          sql`${creditos.asesor_id} IS NOT DISTINCT FROM ${asesorActual}`,
        ),
      )
      .returning({ credito_id: creditos.credito_id });
    if (filas.length !== 1) return false;

    await tx.insert(credito_asesor_historial).values({
      credito_id,
      asesor_anterior: asesorActual,
      asesor_nuevo: asesorElegido,
      bucket: destino,
      origen: "API_MANUAL",
      motivo: `Recuperación de vehículo — traslado a B${destino}: ${motivo}`,
      usuario_id: usuarioId,
    });
    return true;
  });

  if (!resultado) {
    return {
      success: false,
      status: 409,
      message:
        "[ERROR] El asesor del crédito cambió durante el traslado. Actualiza la vista e intenta de nuevo.",
    };
  }

  return {
    success: true,
    credito_id,
    bucket_anterior: bucketAnterior,
    bucket_nuevo: destino,
    tipo_evento: tipoEvento,
    asesor_anterior: asesorActual,
    asesor_nuevo: cambiaAsesor ? asesorElegido : asesorActual,
    asesor_sin_cambio: !cambiaAsesor,
  };
}
