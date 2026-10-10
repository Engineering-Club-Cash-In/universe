import { and, eq, sql } from "drizzle-orm";
import { db } from "../../database";
import {
  asesor_bucket,
  asesores,
  buckets,
  buckets_historial,
  credito_asesor_historial,
  creditos,
  moras_credito,
  platform_users,
} from "../../database/db/schema";
import { STATUS_EXCLUIDOS_MORA } from "../../constants/creditStatus";
import { BUCKET_JURIDICO, motivoBucketNoJuridico } from "../../lib/buckets-juridico";
import {
  BUCKETS_CONVENIO_LOCK_KEY,
  CREDITO_ASESOR_LOCK_NAMESPACE,
  PROCESAR_MORAS_LOCK_KEY,
} from "../../lib/buckets-job-locks";
import {
  contarCuotasVencidasReales,
  elegirAsesorParaBucket,
  STATUS_EN_JURIDICO,
} from "../latefee";
import {
  esLockTimeout,
  getCargaDelBucket,
  getEstadoCredito,
  RecuperacionAbortada,
} from "./recuperacionVehiculo";

// ─────────────────────────────────────────────────────────────────────────────
// COBROS-02 Workspace (issue #1873, W3) · ESCALAR A JURÍDICO (traslado manual a B5).
//
// Mismo mecanismo que la recuperación de vehículo (recuperacionVehiculo.ts):
//  · fila en `buckets_historial` (origen API_MANUAL) con el bucket nuevo;
//  · el estado `EN_JURIDICO` como PISO de B5 (`buckets.estados_piso`): el motor
//    no baja el crédito de B5 mientras esté, y sí lo sube si la mora lo pide;
//  · el caso SALE de la cartera del asesor: se elige un asesor del pool de B5
//    distinto del actual (con el par UPDATE creditos.asesor_id /
//    INSERT credito_asesor_historial, con compare-and-swap).
//
// Se levanta solo al validarse un pago que deja al crédito sin deuda (ver
// levantarRecuperacion.ts, que atiende EN_JURIDICO igual que EN_RECUPERACION).
// ─────────────────────────────────────────────────────────────────────────────

const LOCK_TIMEOUT = "5s";

/**
 * Plazo del servidor para TODA la operación, incluida la espera de una conexión
 * del pool. El `lock_timeout` solo corre dentro de la transacción: con el pool
 * agotado, el handler podía quedar en cola y commitear mucho después de que el
 * CRM cortó su llamada y un supervisor rechazó la solicitud. Tiene que ser menor
 * que la espera del CRM antes de permitir ese rechazo.
 */
const PLAZO_OPERACION_MS = 90_000;

/** El crédito ya estaba en Jurídico: un reintento no vuelve a escribir nada. */
class JuridicoYaAplicado extends Error {}

/**
 * Fallo REINTENTABLE (no es un rechazo de negocio): el CRM lo deja pendiente de
 * repetir la aprobación. `codigo` es estable para que el CRM no lo confunda con un
 * rechazo. `bucket_ocupado`: el cron de moras o convenios tiene el candado (00:05 /
 * 00:30). `pool_b5_sin_asesor`: el pool de Jurídico no tiene otro asesor activo
 * (configuración: se repite cuando se corrija).
 */
class JuridicoReintentable extends Error {
  constructor(readonly status: number, readonly codigo: "bucket_ocupado" | "pool_b5_sin_asesor", message: string) {
    super(message);
  }
}

export type JuridicoResultado =
  | {
      success: true;
      credito_id: number;
      bucket_anterior: number;
      bucket_nuevo: number;
      asesor_anterior: number | null;
      asesor_nuevo: number;
      status_credito: string;
    }
  | { success: false; status: number; message: string; codigo?: "ya_en_juridico" | "bucket_ocupado" | "pool_b5_sin_asesor" };

/**
 * Escala un crédito a Jurídico (B5). Idempotente en la práctica: un segundo
 * intento lo rechaza porque el estado ya es EN_JURIDICO.
 */
export async function enviarAJuridico(params: {
  credito_id: number;
  motivo: string;
  usuario_email?: string;
  asesor_esperado_email?: string;
}): Promise<JuridicoResultado> {
  const { credito_id } = params;
  const motivo = (params.motivo ?? "").trim();
  const destino = BUCKET_JURIDICO;

  if (!motivo) {
    return { success: false, status: 400, message: "[ERROR] El motivo es obligatorio" };
  }

  const venceEn = Date.now() + PLAZO_OPERACION_MS;
  try {
    return await db.transaction(async (tx) => {
      // Primera instrucción: si la conexión llegó tarde, ya nadie espera esta
      // respuesta y escribir sería posible tras un rechazo. Se aborta sin escribir.
      if (Date.now() > venceEn) {
        throw new RecuperacionAbortada(
          503,
          "[ERROR] La operación venció esperando una conexión de la base. Intente de nuevo en un momento.",
        );
      }
      await tx.execute(sql`SET LOCAL lock_timeout = ${sql.raw(`'${LOCK_TIMEOUT}'`)}`);

      // Locks SIN ESPERAR, por la misma política que la recuperación: si el cron
      // de moras los tiene, es mejor pedirle a la persona que reintente.
      const locks = await tx.execute<{ moras: boolean; convenio: boolean; credito: boolean }>(sql`
        SELECT
          pg_try_advisory_xact_lock(${PROCESAR_MORAS_LOCK_KEY})   AS moras,
          pg_try_advisory_xact_lock(${BUCKETS_CONVENIO_LOCK_KEY}) AS convenio,
          pg_try_advisory_xact_lock(${CREDITO_ASESOR_LOCK_NAMESPACE}, ${credito_id}) AS credito
      `);
      const tomados = locks.rows?.[0];
      if (!tomados?.moras || !tomados?.convenio || !tomados?.credito) {
        throw new JuridicoReintentable(
          409,
          "bucket_ocupado",
          "[ERROR] Hay un proceso de buckets trabajando sobre la cartera en este momento (moras 00:05 / convenios 00:30). Intente de nuevo en unos minutos.",
        );
      }

      const [bucketDestino] = await tx
        .select({ numero: buckets.numero, nombre: buckets.nombre })
        .from(buckets)
        .where(and(eq(buckets.numero, destino), eq(buckets.activo, true)));
      if (!bucketDestino) {
        throw new RecuperacionAbortada(
          409,
          `[ERROR] El bucket B${destino} (Jurídico) no existe o está inactivo en el catálogo.`,
        );
      }

      // Lock de fila ANTES de leer el estado y la deuda viva: un pago que está
      // validando (y que podría levantar Jurídico) toma esta fila al actualizarla,
      // así que o commitea antes de esta lectura o espera a que termine el escalado.
      // Los advisory locks de arriba no lo cubren: el pago no los toma.
      await tx
        .select({ credito_id: creditos.credito_id })
        .from(creditos)
        .where(eq(creditos.credito_id, credito_id))
        .for("update");

      const estado = await getEstadoCredito(credito_id, tx);
      if (!estado) {
        throw new RecuperacionAbortada(404, `[ERROR] No se encontró crédito con credito_id=${credito_id}`);
      }
      if (estado.fuera_del_funnel) {
        throw new RecuperacionAbortada(
          400,
          `[ERROR] El crédito está en estado ${estado.status_credito} (fuera del funnel operativo): no se escala a Jurídico.`,
        );
      }
      if (estado.status_credito === STATUS_EN_JURIDICO) {
        // `codigo` estable: el CRM lo trata como ya aplicado si reintenta una
        // aprobación cuya primera respuesta se perdió.
        throw new JuridicoYaAplicado();
      }
      if (STATUS_EXCLUIDOS_MORA.includes(estado.status_credito ?? "")) {
        throw new RecuperacionAbortada(
          409,
          `[ERROR] El crédito está en ${estado.status_credito}, que tiene su propio régimen: no se escala a Jurídico desde ahí.`,
        );
      }
      if (estado.bucket_actual === null) {
        throw new RecuperacionAbortada(400, "[ERROR] El crédito no tiene bucket actual: no se puede registrar el escalamiento.");
      }
      const noEscalable = motivoBucketNoJuridico(estado.bucket_actual);
      if (noEscalable) {
        throw new RecuperacionAbortada(400, `[ERROR] ${noEscalable}`);
      }

      // La deuda VIVA, no el bucket: `bucket_actual` sale del último
      // buckets_historial y no baja hasta la corrida nocturna. Si el cliente
      // saldó mientras la solicitud esperaba, ese pago ya se validó y el hook que
      // levanta Jurídico no volvería a correr: el crédito quedaría atascado.
      const cuotasVencidas = await contarCuotasVencidasReales(
        credito_id,
        estado.status_credito ?? "",
        tx as never,
      );
      const [moraViva] = await tx
        .select({ monto: moras_credito.monto_mora })
        .from(moras_credito)
        .where(and(eq(moras_credito.credito_id, credito_id), eq(moras_credito.activa, true)))
        .limit(1);
      if (cuotasVencidas === 0 && !(moraViva && Number(moraViva.monto) > 0)) {
        throw new RecuperacionAbortada(
          409,
          "[ERROR] El crédito ya no tiene cuotas vencidas ni mora: no se escala a Jurídico.",
        );
      }

      // Precondición de dueño, bajo los locks (igual que la recuperación).
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
            "[ERROR] El crédito se reasignó a otro asesor mientras se escalaba a Jurídico. Actualice la vista e intente de nuevo.",
          );
        }
      }

      const bucketAnterior = estado.bucket_actual;
      const tipoEvento: "SUBIDA" | "BAJADA" = destino > bucketAnterior ? "SUBIDA" : "BAJADA";

      // Pool de B5 SIN el dueño actual: el caso sale de su cartera. Se elige el de
      // menor carga, con la misma función pura del motor.
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
      const asesorActual = estado.asesor_id;
      const pool = poolRows
        .map((r) => r.asesor_id)
        .filter((id) => id !== asesorActual);
      if (pool.length === 0) {
        throw new JuridicoReintentable(
          409,
          "pool_b5_sin_asesor",
          `[ERROR] B${destino} no tiene otro asesor activo en su pool: el caso quedaría con el mismo asesor. Configure el pool de Jurídico antes de escalar.`,
        );
      }
      const asesorElegido = elegirAsesorParaBucket(pool, await getCargaDelBucket(destino, tx), null);
      if (asesorElegido === null) {
        throw new RecuperacionAbortada(409, "[ERROR] No se pudo elegir un asesor para Jurídico.");
      }

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
      const actor = params.usuario_email?.trim();
      const motivoBucket = actor
        ? `Escalado a Jurídico (solicitado por ${actor}): ${motivo}`
        : `Escalado a Jurídico: ${motivo}`;

      // El dueño va primero, con compare-and-swap: si cambió bajo los locks, se
      // aborta y revierte en vez de dejar el crédito en B5 sin su reasignación.
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
          "[ERROR] El asesor del crédito cambió durante el escalamiento. Actualice la vista e intente de nuevo.",
        );
      }
      await tx.insert(credito_asesor_historial).values({
        credito_id,
        asesor_anterior: asesorActual,
        asesor_nuevo: asesorElegido,
        bucket: destino,
        origen: "API_MANUAL",
        motivo: `Escalado a Jurídico — B${destino}: ${motivo}`,
        usuario_id: usuarioId,
      });

      // El estado en la MISMA transacción que el traslado: sin él, un fallo entre
      // las dos escrituras devolvería el crédito a su bucket por cuotas esa noche.
      await tx
        .update(creditos)
        // Entrar a Jurídico invalida la marca de un levantamiento de recuperación
        // anterior: si no, reversar ese pago viejo resucitaría EN_RECUPERACION
        // por encima de esta decisión más nueva.
        .set({ statusCredit: STATUS_EN_JURIDICO, recuperacion_levantada_pago_id: null })
        .where(eq(creditos.credito_id, credito_id));

      await tx.insert(buckets_historial).values({
        credito_id,
        bucket_anterior: bucketAnterior,
        bucket_nuevo: destino,
        tipo_evento: tipoEvento,
        origen: "API_MANUAL",
        cuotas_atrasadas_nuevas: estado.cuotas_atrasadas,
        status_credito: STATUS_EN_JURIDICO,
        motivo: motivoBucket,
      });

      return {
        success: true as const,
        credito_id,
        bucket_anterior: bucketAnterior,
        bucket_nuevo: destino,
        asesor_anterior: asesorActual,
        asesor_nuevo: asesorElegido,
        status_credito: STATUS_EN_JURIDICO,
      };
    });
  } catch (err) {
    if (err instanceof JuridicoYaAplicado) {
      return {
        success: false,
        status: 409,
        codigo: "ya_en_juridico",
        message: "[ERROR] El crédito ya está en Jurídico.",
      };
    }
    if (err instanceof JuridicoReintentable) {
      return { success: false, status: err.status, codigo: err.codigo, message: err.message };
    }
    if (err instanceof RecuperacionAbortada) {
      return { success: false, status: err.status, message: err.message };
    }
    if (esLockTimeout(err)) {
      return {
        success: false,
        status: 409,
        codigo: "bucket_ocupado" as const,
        message: "[ERROR] El proceso de buckets está corriendo sobre este crédito. Espere a que termine e intente de nuevo.",
      };
    }
    throw err;
  }
}

/**
 * Al reinstalar Jurídico por la reversa del pago que lo levantó: el motor pudo
 * haber devuelto el crédito (y su asesor) a un bucket menor mientras tanto, y el
 * piso lo clasifica en B5 de nuevo. Acá se le devuelve el dueño del pool de B5,
 * con el mismo par UPDATE / historial que el escalamiento original.
 *
 * Nunca lanza ni espera: una reversa no puede fallar por esto. Sin candado libre,
 * sin pool o con el dueño ya dentro del pool de B5, no hace nada (la corrida del
 * motor reasigna). Corre sobre el ejecutor de la reversa.
 */
export async function reasignarAsesorDeJuridicoSiHaceFalta(
  credito_id: number,
  motivo: string,
  ejecutor: Pick<typeof db, "select" | "update" | "insert" | "execute">,
): Promise<boolean> {
  try {
    const { enSavepoint } = await import("./levantarRecuperacion");
    return await enSavepoint(ejecutor, (e) => reasignarEn(credito_id, motivo, e as never));
  } catch (err) {
    console.error(`[JURIDICO] ⚠️ No se pudo reasignar el asesor de B5 al crédito ${credito_id}:`, err);
    return false;
  }
}

async function reasignarEn(
  credito_id: number,
  motivo: string,
  ejecutor: Pick<typeof db, "select" | "update" | "insert" | "execute">,
): Promise<boolean> {
  {
    const destino = BUCKET_JURIDICO;
    const lock = await ejecutor.execute<{ ok: boolean }>(
      sql`SELECT pg_try_advisory_xact_lock(${CREDITO_ASESOR_LOCK_NAMESPACE}, ${credito_id}) AS ok`,
    );
    if (!lock.rows?.[0]?.ok) return false;

    const [actual] = await ejecutor
      .select({ asesor_id: creditos.asesor_id })
      .from(creditos)
      .where(eq(creditos.credito_id, credito_id))
      .limit(1);
    if (!actual) return false;

    const poolRows = await ejecutor
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
    if (pool.length === 0) return false;
    // Ya lo tiene un asesor del pool de Jurídico: nada que mover.
    if (actual.asesor_id !== null && pool.includes(actual.asesor_id)) return false;

    const elegido = elegirAsesorParaBucket(pool, await getCargaDelBucket(destino, ejecutor as never), null);
    if (elegido === null) return false;

    const filas = await ejecutor
      .update(creditos)
      .set({ asesor_id: elegido })
      .where(
        and(
          eq(creditos.credito_id, credito_id),
          sql`${creditos.asesor_id} IS NOT DISTINCT FROM ${actual.asesor_id}`,
        ),
      )
      .returning({ credito_id: creditos.credito_id });
    if (filas.length !== 1) return false;

    await ejecutor.insert(credito_asesor_historial).values({
      credito_id,
      asesor_anterior: actual.asesor_id,
      asesor_nuevo: elegido,
      bucket: destino,
      origen: "API_MANUAL",
      motivo,
      usuario_id: null,
    });
    return true;
  }
}
