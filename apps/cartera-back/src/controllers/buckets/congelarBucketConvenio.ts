import { sql } from "drizzle-orm";
import { db } from "../../database";
import { SQL_CARTERA_SCHEMA } from "../../database/db/schema";
import { CREDITO_ASESOR_LOCK_NAMESPACE } from "../../lib/buckets-job-locks";

// ─────────────────────────────────────────────────────────────────────────────
// COBROS-02 · Fase 2 — EL CONVENIO CONGELA EL BUCKET.
//
// Regla acordada con el PM (decisión 9 del plan 08): al firmar un convenio el
// crédito NO baja de bucket ni cambia de asesor. Se queda donde estaba hasta
// que se pague completo o alguien deshaga el acuerdo.
//
// Esto invierte lo que hacía el job de convenios, que aplicaba "borrón y cuenta
// nueva": la deuda que el convenio absorbía dejaba de contar como atraso, así
// que un convenio recién firmado caía a B0 y se lo llevaba el asesor de B0 —
// justo el que menos contexto tenía de esa negociación.
//
// ── Por qué hace falta ESCRIBIR una fila ────────────────────────────────────
// Para un crédito EN_CONVENIO, `bucketActualSql` ignora a propósito todo el
// historial que no sea de su régimen de convenio (review Codex #1223: si no, se
// leería el B3 que tenía como MOROSO, que allá era un bucket zombie). Con el
// congelamiento ese bucket YA NO es zombie —es la respuesta— pero el lector
// necesita verlo en una fila propia. De ahí el evento `CONGELADO`.
//
// ── Cuándo corre ─────────────────────────────────────────────────────────────
//  1. Al CREAR el convenio (`createPaymentAgreement`), que es cuando el crédito
//     pasa a EN_CONVENIO: ahí se lee el bucket ANTES del cambio de estado y se
//     escribe la fila. Es el camino normal y el único que ve el bucket real.
//  2. Como RED DE SEGURIDAD en el job de convenios, para lo que llegó por otra
//     puerta (carteraFront, convenios viejos, un fallo del paso 1).
//
// ── Cuándo TERMINA el congelamiento ─────────────────────────────────────────
// No hay evento de salida, y es a propósito (review de Codex, P2). Cuando el
// convenio se completa, se rechaza o se deshace, el crédito vuelve a
// ACTIVO/MOROSO y la fila `CONGELADO` sigue siendo la última del historial
// hasta que el motor de las 23:59 deriva el bucket real y escribe la
// transición contra ella. La ventana es de horas, no permanente: el motor
// recorre TODOS los créditos con cuotas —no solo los que tienen mora—, así que
// un crédito que salió del convenio sin deber nada igual se visita y baja
// (`BAJADA` a B0 se observa en la bitácora).
//
// Escribir el evento de salida en el momento se ve más correcto y es peor. El
// motor solo reasigna cuando detecta cambio de bucket (`if (bucketNuevo ===
// bucketAnterior) continue`), así que una fila eager con el bucket ya correcto
// se COME esa transición: el crédito queda en el bucket que le toca pero con
// el asesor de B4/B5 que tenía congelado, y nada lo vuelve a mover. Se
// cambiaría un bucket desactualizado por unas horas por un dueño equivocado
// para siempre. Soltar el congelamiento y re-hogar el crédito son el mismo
// paso, y ese paso vive en el motor.
// ─────────────────────────────────────────────────────────────────────────────

/** Bucket de re-siembra cuando no hay de dónde deducir el origen (decisión 19). */
export const BUCKET_CONVENIO_AL_DIA = 2;
export const BUCKET_CONVENIO_ATRASADO = 4;

type Ejecutor = Pick<typeof db, "execute">;

/**
 * Bucket con el que el crédito entra al convenio, leído ANTES de que su status
 * cambie a EN_CONVENIO. Es la derivación normal (`bucketActualSql`): última
 * fila del historial → estado que fuerza bucket → rango de cuotas de la mora.
 *
 * Devuelve null si el crédito no existe o si ya está fuera del funnel — el
 * caller decide qué hacer (en la creación del convenio, no congelar nada).
 */
export async function bucketAntesDelConvenio(
  credito_id: number,
  ejecutor: Ejecutor = db,
): Promise<number | null> {
  // No se usa `bucketActualSql` acá, y la diferencia es UNA línea con
  // consecuencias (review de Codex, P2): ese lector, para un crédito que NO
  // está EN_CONVENIO, acepta el historial de cualquier régimen — incluida la
  // fila `CONGELADO` de un convenio ANTERIOR.
  //
  // El escenario: se rechaza un convenio y se firma otro antes de que corra el
  // motor de las 23:59. El rechazo devuelve el crédito a MOROSO/ACTIVO pero no
  // escribe historial de bucket, así que la última fila sigue siendo el
  // congelamiento viejo — y el convenio nuevo se congelaba en el bucket del
  // anterior en vez del que le toca por su mora de HOY.
  //
  // Por eso acá el historial de convenio se ignora explícitamente: la pregunta
  // es "qué bucket tiene este crédito FUERA de todo régimen de convenio".
  const res = await ejecutor.execute<{ bucket: number | null }>(sql`
    SELECT COALESCE(
      (SELECT h.bucket_nuevo FROM ${SQL_CARTERA_SCHEMA}.buckets_historial h
        WHERE h.credito_id = c.credito_id
          AND (h.status_credito IS DISTINCT FROM 'EN_CONVENIO')
        ORDER BY h.fecha DESC, h.historial_id DESC
        LIMIT 1),
      (SELECT b.numero FROM ${SQL_CARTERA_SCHEMA}.buckets b
        WHERE b.activo = true
          AND c."statusCredit" = ANY (b.estados_incluidos)
        ORDER BY b.numero LIMIT 1),
      (SELECT b.numero FROM ${SQL_CARTERA_SCHEMA}.buckets b
        WHERE b.activo = true
          AND COALESCE(m.cuotas_atrasadas, 0) >= b.cuotas_min
          AND (b.cuotas_max IS NULL OR COALESCE(m.cuotas_atrasadas, 0) <= b.cuotas_max)
        ORDER BY b.numero LIMIT 1)
    ) AS bucket
    FROM ${SQL_CARTERA_SCHEMA}.creditos c
    LEFT JOIN ${SQL_CARTERA_SCHEMA}.moras_credito m
      ON m.credito_id = c.credito_id AND m.activa = true
    WHERE c.credito_id = ${credito_id}
    LIMIT 1
  `);
  const bucket = res.rows?.[0]?.bucket;
  return bucket === null || bucket === undefined ? null : Number(bucket);
}

/**
 * Bucket de congelamiento para un crédito que YA está EN_CONVENIO — el camino
 * de la red de seguridad, donde `bucketActualSql` devuelve null por diseño.
 *
 * Orden:
 *  1. La última fila del historial FUERA de todo régimen de convenio. Es
 *     literalmente "el bucket que tenía al firmar": para un convenio que nunca
 *     pasó por acá, esa fila es la de cuando era MOROSO.
 *  2. Si no tiene historial —nunca entró al funnel—, no hay origen que
 *     recuperar y se aplica la regla de re-siembra (decisión 19): al día → B2,
 *     atrasado → B4. `mesesAtrasados` lo calcula el caller con el modelo de
 *     siempre (unión de cuotas del crédito no absorbidas + cuotas del convenio).
 *
 * POR QUÉ SE EXCLUYE `EN_CONVENIO` (review de Codex, P2). Cualquier fila de ese
 * régimen que este lector llegue a ver pertenece por fuerza a un convenio
 * ANTERIOR: si fuera del vigente, `tieneBucketDeConvenio(…, desde)` habría dado
 * verdadero y el vigilante no habría llamado acá. Sin la exclusión el escenario
 * se cierra sobre sí mismo: falla el congelamiento de un segundo convenio, el
 * `CONGELADO` del primero sigue siendo la última fila, el vigilante detecta
 * correctamente que no hay evento después del corte nuevo… y vuelve a insertar
 * ESE bucket viejo después del corte. Con eso queda certificado para siempre y
 * ya no hay forma de repararlo: la próxima corrida ve su propia fila y se da
 * por satisfecha. Es la misma razón —y la misma línea— que en
 * `bucketAntesDelConvenio`.
 */
export async function bucketParaCongelarEnConvenio(
  credito_id: number,
  mesesAtrasados: number,
  ejecutor: Ejecutor = db,
): Promise<number> {
  const res = await ejecutor.execute<{ bucket_nuevo: number }>(sql`
    SELECT h.bucket_nuevo
    FROM ${SQL_CARTERA_SCHEMA}.buckets_historial h
    WHERE h.credito_id = ${credito_id}
      AND (h.status_credito IS DISTINCT FROM 'EN_CONVENIO')
    ORDER BY h.fecha DESC, h.historial_id DESC
    LIMIT 1
  `);
  const ultimo = res.rows?.[0]?.bucket_nuevo;
  if (ultimo !== null && ultimo !== undefined) return Number(ultimo);
  return mesesAtrasados > 0 ? BUCKET_CONVENIO_ATRASADO : BUCKET_CONVENIO_AL_DIA;
}

/**
 * ¿El crédito ya tiene fila de bucket para el convenio VIGENTE?
 *
 * El corte por fecha no es cosmético (review de Codex, P2): preguntar por
 * cualquier fila histórica con `status_credito = 'EN_CONVENIO'` da verdadero
 * para siempre, porque la bitácora es append-only y esas filas nunca se borran.
 * Un crédito que completó o rechazó un convenio y después firma otro quedaba
 * así: el congelamiento del convenio NUEVO se saltaba —tanto al firmar como en
 * la red de seguridad— y `bucketActualSql` seguía exponiendo el bucket del
 * convenio VIEJO en vez del que tenía al firmar este.
 *
 * `desde` es el instante de creación del convenio vigente. Sin él se conserva el
 * comportamiento viejo (cualquier fila del régimen), que es lo correcto para un
 * caller que no sabe de qué convenio habla.
 */
export async function tieneBucketDeConvenio(
  credito_id: number,
  ejecutor: Ejecutor = db,
  desde?: Date | null,
): Promise<boolean> {
  const corte = desde ? sql`AND h.fecha >= ${desde}` : sql``;
  const res = await ejecutor.execute<{ existe: boolean }>(sql`
    SELECT EXISTS (
      SELECT 1 FROM ${SQL_CARTERA_SCHEMA}.buckets_historial h
      WHERE h.credito_id = ${credito_id}
        AND h.status_credito = 'EN_CONVENIO'
        ${corte}
    ) AS existe
  `);
  return Boolean(res.rows?.[0]?.existe);
}

/**
 * Escribe la fila `CONGELADO` que fija el bucket del crédito mientras dure el
 * convenio. Idempotente por su cuenta: si el crédito ya tiene una fila de su
 * régimen de convenio, no hace nada (el congelamiento ya ocurrió).
 *
 * NO lanza: el congelamiento no puede tumbar la creación de un convenio, que es
 * una operación financiera con plata de por medio. Si falla, el crédito queda
 * sin bucket visible hasta la siguiente corrida del job — que lo arregla, para
 * eso existe la red de seguridad. Devuelve el bucket congelado, o null si no
 * hizo nada.
 */
export async function congelarBucketPorConvenio(params: {
  credito_id: number;
  bucket: number;
  convenio_id?: number;
  motivo?: string;
  /**
   * Creación del convenio vigente. Acota la idempotencia a ESE convenio: sin
   * esto, un crédito que ya tuvo uno antes nunca se vuelve a congelar (ver
   * `tieneBucketDeConvenio`).
   */
  desde?: Date | null;
  /**
   * Ejecutor propio. Cuando se pasa, el caller ES dueño de la transacción y de
   * la exclusión: acá no se abre ninguna y no se toma el lock (abrir una
   * transacción anidada o pedir un lock de transacción desde afuera de la suya
   * sería peor que el problema que resuelve).
   */
  ejecutor?: Pick<typeof db, "execute">;
}): Promise<number | null> {
  try {
    // Sin ejecutor propio: comprobar e insertar van juntos, en UNA transacción
    // y detrás del lock por crédito.
    //
    // Por qué (review de Codex, P2): el advisory lock del vigilante solo
    // serializa corridas del vigilante contra sí mismo. Si la firma de un
    // convenio se cruza con esa corrida, las dos pueden ver `false` acá y las
    // dos insertan un CONGELADO — y para un crédito sin historial previo la
    // firma usa su bucket vivo mientras el vigilante cae al default B2/B4, así
    // que el que gane por timestamp decide el bucket visible y puede violar
    // justo la regla que este código existe para sostener ("el bucket que
    // tenía al firmar").
    //
    // La llave es la misma que usa la reasignación de asesor
    // (CREDITO_ASESOR_LOCK_NAMESPACE, credito_id): el congelamiento fija bucket
    // y dueño, así que pertenece a esa familia de operaciones por crédito.
    if (!params.ejecutor) {
      return await db.transaction(async (tx) => {
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(${CREDITO_ASESOR_LOCK_NAMESPACE}, ${params.credito_id})`,
        );
        return await congelarBajoExclusion(params, tx);
      });
    }
    return await congelarBajoExclusion(params, params.ejecutor);
  } catch (err) {
    console.error(
      `[CONGELAR-CONVENIO] ⚠️ No se pudo congelar el bucket del crédito ${params.credito_id}:`,
      err,
    );
    return null;
  }
}

/** El check + insert propiamente dicho. El caller garantiza la exclusión. */
async function congelarBajoExclusion(
  params: {
    credito_id: number;
    bucket: number;
    convenio_id?: number;
    motivo?: string;
    desde?: Date | null;
  },
  ejecutor: Pick<typeof db, "execute">,
): Promise<number | null> {
  if (await tieneBucketDeConvenio(params.credito_id, ejecutor, params.desde))
    return null;

  const motivo =
    params.motivo ??
    (params.convenio_id != null
      ? `Convenio ${params.convenio_id}: el crédito se congela en B${params.bucket} (no baja de bucket ni cambia de asesor)`
      : `Convenio: el crédito se congela en B${params.bucket}`);

  await ejecutor.execute(sql`
    INSERT INTO ${SQL_CARTERA_SCHEMA}.buckets_historial
      (credito_id, bucket_anterior, bucket_nuevo, tipo_evento, origen,
       cuotas_atrasadas_nuevas, status_credito, motivo)
    VALUES
      (${params.credito_id}, ${params.bucket}, ${params.bucket}, 'CONGELADO',
       'PROCESO_AUTO', 0, 'EN_CONVENIO', ${motivo})
  `);
  return params.bucket;
}
