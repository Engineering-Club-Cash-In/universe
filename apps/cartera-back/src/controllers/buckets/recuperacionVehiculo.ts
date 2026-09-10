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
import {
  bucketActualSql,
  STATUS_BUCKET_FUERA,
  STATUS_READER_FUERA,
} from "../../lib/buckets-classification";
import {
  BUCKETS_CONVENIO_LOCK_KEY,
  CREDITO_ASESOR_LOCK_NAMESPACE,
  PROCESAR_MORAS_LOCK_KEY,
} from "../../lib/buckets-job-locks";
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
// creditos.asesor_id / INSERT credito_asesor_historial.
//
// ⚠️ PENDIENTE CONOCIDO (docs/features/cobros-02/07-recuperacion-de-vehiculo.md):
// el traslado NO es permanente. El motor de las 23:59 GT vuelve a derivar el
// bucket de las cuotas atrasadas; un crédito con 2 cuotas que se mandó a B4 hoy
// amanece en B2 mañana. La solución acordada (estado `EN_RECUPERACION` como piso
// en B4) es la fase 4 del documento 8. Este módulo hace el traslado y nada más.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bucket destino de una recuperación de vehículo: B4 "Última Instancia / Pre
 * Jurídico". Es una constante y no un parámetro del request a propósito — este
 * endpoint NO es un "mover a cualquier bucket": esa sería una puerta para
 * romper la invariante de que el bucket lo deriva la mora. Se valida contra el
 * catálogo en cada llamada por si alguien desactiva o renumera el escalón.
 */
export const BUCKET_RECUPERACION_VEHICULO = 4;

/**
 * Tope de espera para los locks de FILA (el UPDATE del crédito). Los advisory
 * locks de abajo NO esperan: se piden con `pg_try_advisory_xact_lock`.
 */
const LOCK_TIMEOUT = "5s";

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

/**
 * Falla de validación DENTRO de la transacción. Se lanza (en vez de devolver un
 * resultado) para que Postgres revierta todo lo escrito hasta ahí: devolver un
 * valor desde el callback de `db.transaction` hace COMMIT, no ROLLBACK, y con
 * eso una validación tardía dejaba el crédito movido a B4 mientras la API
 * respondía un error (review de Codex, P1).
 */
class RecuperacionAbortada extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RecuperacionAbortada";
  }
}

type Ejecutor = Pick<typeof db, "select" | "execute" | "insert" | "update">;

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
async function getEstadoCredito(
  credito_id: number,
  ejecutor: Ejecutor,
): Promise<EstadoCredito | null> {
  const fueraSql = sql.join(STATUS_BUCKET_FUERA.map((s) => sql`${s}`), sql`, `);
  const res = await ejecutor.execute<{
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
 *
 * El filtro por `STATUS_READER_FUERA` es el mismo de la query canónica de carga
 * (`cargaAsesorBucket.ts`) y no es opcional: `bucketActualSql` prioriza la última
 * fila de `buckets_historial` y NO excluye estados cerrados por su cuenta, así
 * que un CANCELADO/CAIDO con una fila vieja de B4 seguía contando como carga viva
 * y mandaba las recuperaciones nuevas al asesor equivocado (review de Codex, P2).
 * Conserva EN_CONVENIO: esos créditos sí se atienden.
 */
async function getCargaDelBucket(
  bucket: number,
  ejecutor: Ejecutor,
): Promise<Map<number, number>> {
  const cerradosSql = sql.join(STATUS_READER_FUERA.map((s) => sql`${s}`), sql`, `);
  const res = await ejecutor.execute<{ asesor_id: number; cuentas: number }>(sql`
    SELECT c.asesor_id, COUNT(*)::int AS cuentas
    FROM ${SQL_CARTERA_SCHEMA}.creditos c
    LEFT JOIN ${SQL_CARTERA_SCHEMA}.moras_credito m
      ON m.credito_id = c.credito_id AND m.activa = true
    WHERE c.asesor_id IS NOT NULL
      AND c."statusCredit" NOT IN (${cerradosSql})
      AND ${bucketActualSql("c", "m")} = ${bucket}
    GROUP BY c.asesor_id
  `);
  const carga = new Map<number, number>();
  for (const row of res.rows ?? []) {
    carga.set(Number(row.asesor_id), Number(row.cuentas));
  }
  return carga;
}

/** ¿El error viene de que no se pudo tomar un lock dentro de `lock_timeout`? */
function esLockTimeout(err: unknown): boolean {
  return (err as { code?: string })?.code === "55P03";
}

/**
 * Manda un crédito a recuperación de vehículo: lo traslada a B4 y lo reasigna
 * al asesor que cubre ese bucket. Motivo obligatorio (es una decisión humana y
 * la bitácora tiene que poder responder por qué).
 *
 * `asesor_esperado_email` es la PRECONDICIÓN de dueño: quien autorizó del lado
 * del CRM verificó, en otra request, que el crédito era de esa persona. Entre esa
 * verificación y esta escritura el motor o un supervisor pueden haberlo
 * reasignado, y sin precondición el asesor que ya lo perdió movía igual la cuenta
 * (review de Codex, P1). Se revalida acá adentro, bajo los locks, contra el dueño
 * real. Va vacío cuando quien llama ve toda la cartera (admin / supervisor): ahí
 * no hay dueño esperado que exigir.
 *
 * TODO —lectura del estado incluida— corre dentro de una transacción que primero
 * toma los advisory locks de los DOS jobs de bucket y después el del crédito. El
 * lock por crédito solo no alcanzaba: ni `procesarMoras` ni el job de convenios
 * lo toman (usan sus llaves globales), así que una corrida solapada leía el mismo
 * dueño viejo y escribía historia contradictoria o pisaba la reasignación
 * (review de Codex, P1). Mismo orden de llaves que el traslado masivo, que es
 * quien define la convención.
 */
export async function enviarARecuperacionVehiculo(params: {
  credito_id: number;
  motivo: string;
  usuario_email?: string;
  asesor_esperado_email?: string;
}): Promise<RecuperacionVehiculoResultado> {
  const { credito_id } = params;
  const motivo = (params.motivo ?? "").trim();
  const destino = BUCKET_RECUPERACION_VEHICULO;

  // Única validación que no necesita la foto: se resuelve antes de pedir locks.
  if (!motivo) {
    return { success: false, status: 400, message: "[ERROR] El motivo es obligatorio" };
  }

  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = ${sql.raw(`'${LOCK_TIMEOUT}'`)}`);

      // Los tres locks se piden SIN ESPERAR. La política de la casa es asimétrica
      // y hay que respetarla desde el lado débil: el cron de mora pide esta misma
      // llave con `pg_try_advisory_lock` (latefee.ts) y, si no la consigue, se
      // OMITE LA CORRIDA COMPLETA de la noche —sin reintento, y el wrapper la
      // registra como exitosa—. Un botón por crédito que espera 5s puede, si el
      // clic cae en el minuto del cron, costar la mora de toda la cartera de esa
      // noche. Entre hacer esperar a una persona que puede reintentar y hacerle
      // perder la noche al job que no reintenta, gana el job (review humana de
      // @jalvaradoatcci). Además evita retener una conexión del pool de trabajo
      // durante la espera.
      const locks = await tx.execute<{ moras: boolean; convenio: boolean; credito: boolean }>(sql`
        SELECT
          pg_try_advisory_xact_lock(${PROCESAR_MORAS_LOCK_KEY})   AS moras,
          pg_try_advisory_xact_lock(${BUCKETS_CONVENIO_LOCK_KEY}) AS convenio,
          pg_try_advisory_xact_lock(${CREDITO_ASESOR_LOCK_NAMESPACE}, ${credito_id}) AS credito
      `);
      const tomados = locks.rows?.[0];
      if (!tomados?.moras || !tomados?.convenio || !tomados?.credito) {
        throw new RecuperacionAbortada(
          409,
          "[ERROR] Hay un proceso de buckets trabajando sobre la cartera en este momento (moras 23:59 / convenios 00:30). Intentá de nuevo en unos minutos.",
        );
      }

      // 1. El bucket destino tiene que existir y estar activo en el catálogo. Si
      //    alguien lo desactivó, es mejor reventar que sembrar una fila que apunta
      //    a un escalón que ya no se atiende.
      const [bucketDestino] = await tx
        .select({ numero: buckets.numero, nombre: buckets.nombre })
        .from(buckets)
        .where(and(eq(buckets.numero, destino), eq(buckets.activo, true)));
      if (!bucketDestino) {
        throw new RecuperacionAbortada(
          409,
          `[ERROR] El bucket B${destino} (recuperación de vehículo) no existe o está inactivo en el catálogo.`,
        );
      }

      // 2. Estado del crédito. Se lee DESPUÉS de los locks: es la foto sobre la
      //    que se decide y ya nadie más la puede mover mientras dure la tx.
      const estado = await getEstadoCredito(credito_id, tx);
      if (!estado) {
        throw new RecuperacionAbortada(
          404,
          `[ERROR] No se encontró crédito con credito_id=${credito_id}`,
        );
      }
      if (estado.fuera_del_funnel) {
        throw new RecuperacionAbortada(
          400,
          `[ERROR] El crédito está en estado ${estado.status_credito} (fuera del funnel operativo): no se traslada a recuperación.`,
        );
      }
      if (estado.bucket_actual === null) {
        throw new RecuperacionAbortada(
          400,
          "[ERROR] El crédito no tiene bucket actual: no se puede registrar el traslado.",
        );
      }
      if (estado.bucket_actual === destino) {
        throw new RecuperacionAbortada(
          400,
          `[ERROR] El crédito ya está en B${destino} (${bucketDestino.nombre}).`,
        );
      }

      // 2.b Precondición de dueño, YA bajo los locks. La autorización del CRM
      //     ocurrió en otra request; si entre medio el motor o un supervisor
      //     reasignaron el crédito, quien pidió esto ya no es su asesor y no
      //     puede moverlo. Se compara por `email_cash_in`, el mismo puente por
      //     correo que usa el CRM para decidir la propiedad.
      const esperado = params.asesor_esperado_email?.trim().toLowerCase();
      if (esperado) {
        const [dueno] = estado.asesor_id
          ? await tx
              .select({ email: asesores.emailCashIn })
              .from(asesores)
              .where(eq(asesores.asesor_id, estado.asesor_id))
          : [];
        const emailDueno = dueno?.email?.trim().toLowerCase();
        if (!emailDueno || emailDueno !== esperado) {
          throw new RecuperacionAbortada(
            409,
            "[ERROR] El crédito se reasignó a otro asesor mientras se enviaba a recuperación. Actualizá la vista e intentá de nuevo.",
          );
        }
      }

      const bucketAnterior = estado.bucket_actual;
      const tipoEvento: "SUBIDA" | "BAJADA" =
        destino > bucketAnterior ? "SUBIDA" : "BAJADA";

      // 3. Asesor destino con la MISMA regla del motor: si el dueño actual ya está
      //    en el pool de B4 se queda (sin churn); si no, el de menor carga.
      const poolRows = await tx
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
        throw new RecuperacionAbortada(
          409,
          `[ERROR] B${destino} no tiene asesores activos en su pool: el crédito quedaría sin dueño. Configurá el pool antes de mandar cuentas a recuperación.`,
        );
      }
      const asesorActual = estado.asesor_id;
      // `getCargaDelBucket` es un agregado sobre TODA la cartera con
      // `bucketActualSql` en el WHERE (tres subconsultas correlacionadas por
      // fila), y se estaba evaluando siempre por ser argumento — incluso en el
      // caso común, donde `elegirAsesorParaBucket` corta en su primera línea
      // porque el dueño ya cubre el bucket y nunca mira el mapa. Calcularla solo
      // cuando decide encoge de forma notoria el rato que la transacción retiene
      // los locks (review humana de @jalvaradoatcci).
      const hayQueRepartir =
        asesorActual === null || !pool.includes(asesorActual);
      const asesorElegido = elegirAsesorParaBucket(
        pool,
        hayQueRepartir ? await getCargaDelBucket(destino, tx) : undefined,
        asesorActual,
      );
      const cambiaAsesor = asesorElegido !== null && asesorElegido !== asesorActual;

      // 4. Identidad de quien lo pidió (best-effort, mismo patrón que reasignarAsesor).
      // Se normaliza igual que el texto del motivo: comparar el correo crudo
      // dejaba `usuario_id` en NULL por un espacio o una mayúscula distinta,
      // justo en la fila que existe para responder quién reasignó el crédito
      // (review humana de @jalvaradoatcci).
      let usuarioId: number | null = null;
      const correoActor = params.usuario_email?.trim().toLowerCase();
      if (correoActor) {
        const [u] = await tx
          .select({ id: platform_users.id })
          .from(platform_users)
          .where(sql`lower(trim(${platform_users.email})) = ${correoActor}`)
          .limit(1);
        usuarioId = u?.id ?? null;
      }

      // `buckets_historial` no tiene columna usuario_id (el motor, su único
      // escritor hasta hoy, no la necesitaba). Mientras no exista, el actor va
      // dentro del motivo: sin esto, un traslado que no cambia de asesor no deja
      // rastro de QUIÉN lo pidió, porque el usuario_id vive en
      // credito_asesor_historial.
      const actor = params.usuario_email?.trim();
      const motivoBucket = actor
        ? `Recuperación de vehículo (solicitada por ${actor}): ${motivo}`
        : `Recuperación de vehículo: ${motivo}`;

      // 5. Escrituras. El UPDATE del dueño va ANTES de la fila de bucket y con
      //    compare-and-swap: si aun con los locks el dueño cambió, se aborta y
      //    revierte, en vez de dejar el crédito en B4 sin su reasignación.
      if (cambiaAsesor && asesorElegido !== null) {
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
        if (filas.length !== 1) {
          throw new RecuperacionAbortada(
            409,
            "[ERROR] El asesor del crédito cambió durante el traslado. Actualiza la vista e intenta de nuevo.",
          );
        }
        await tx.insert(credito_asesor_historial).values({
          credito_id,
          asesor_anterior: asesorActual,
          asesor_nuevo: asesorElegido,
          bucket: destino,
          origen: "API_MANUAL",
          motivo: `Recuperación de vehículo — traslado a B${destino}: ${motivo}`,
          usuario_id: usuarioId,
        });
      }

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

      return {
        success: true as const,
        credito_id,
        bucket_anterior: bucketAnterior,
        bucket_nuevo: destino,
        tipo_evento: tipoEvento,
        asesor_anterior: asesorActual,
        asesor_nuevo: cambiaAsesor ? asesorElegido : asesorActual,
        asesor_sin_cambio: !cambiaAsesor,
      };
    });
  } catch (err) {
    if (err instanceof RecuperacionAbortada) {
      return { success: false, status: err.status, message: err.message };
    }
    if (esLockTimeout(err)) {
      return {
        success: false,
        status: 409,
        message:
          "[ERROR] El job de buckets está corriendo sobre este crédito. Esperá a que termine (23:59 moras / 00:30 convenios) e intentá de nuevo.",
      };
    }
    throw err;
  }
}
