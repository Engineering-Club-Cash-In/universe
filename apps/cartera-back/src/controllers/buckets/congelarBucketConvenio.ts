import { sql } from "drizzle-orm";
import { db } from "../../database";
import { SQL_CARTERA_SCHEMA } from "../../database/db/schema";
import { bucketActualSql } from "../../lib/buckets-classification";

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
  const res = await ejecutor.execute<{ bucket: number | null }>(sql`
    SELECT ${bucketActualSql("c", "m")} AS bucket
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
 *  1. La última fila del historial, del régimen que sea. Es literalmente "el
 *     bucket que tenía al firmar": para un convenio que nunca pasó por acá, esa
 *     fila es la de cuando era MOROSO.
 *  2. Si no tiene historial —nunca entró al funnel—, no hay origen que
 *     recuperar y se aplica la regla de re-siembra (decisión 19): al día → B2,
 *     atrasado → B4. `mesesAtrasados` lo calcula el caller con el modelo de
 *     siempre (unión de cuotas del crédito no absorbidas + cuotas del convenio).
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
  ejecutor?: Pick<typeof db, "execute">;
}): Promise<number | null> {
  const ejecutor = params.ejecutor ?? db;
  try {
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
  } catch (err) {
    console.error(
      `[CONGELAR-CONVENIO] ⚠️ No se pudo congelar el bucket del crédito ${params.credito_id}:`,
      err,
    );
    return null;
  }
}
