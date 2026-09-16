import { client, db } from "../database";
import { BUCKETS_CONVENIO_LOCK_KEY } from "../lib/buckets-job-locks";
import { medirAtrasoDeConvenios } from "./buckets/atrasoConvenio";
import {
  bucketParaCongelarEnConvenio,
  congelarBucketPorConvenio,
  tieneBucketDeConvenio,
} from "./buckets/congelarBucketConvenio";

// ============================================================
// 🧊 VIGILANTE DE BUCKETS DE CONVENIO (COBROS-02 · Fase 2)
// ============================================================
// ⚠️ ESTE JOB YA NO MUEVE BUCKETS. Antes era un motor: recalculaba el bucket de
// cada EN_CONVENIO con "borrón y cuenta nueva" y reasignaba el asesor. La regla
// acordada con el PM (decisión 9 del plan 08) es la contraria — el convenio
// CONGELA bucket y asesor hasta que se pague o alguien lo deshaga — así que lo
// que queda es un vigilante con dos trabajos:
//
//   1. RED DE SEGURIDAD: congelar el bucket de los EN_CONVENIO que no tengan
//      fila de su régimen. El camino normal es `createPaymentAgreement`, que
//      congela al firmar; acá caen los que llegaron por otra puerta
//      (carteraFront, convenios viejos, un fallo del congelamiento).
//   2. MEDIR el atraso del convenio, solo para el log. Quién avisa de un
//      convenio incumplido es el job del CRM (Fase 1), que lee
//      `GET /convenio/alertas`.
//
// Lo que se fue, y por qué:
//   · `nacioConElConvenio` y el borrón y cuenta nueva: la deuda que el convenio
//     absorbía dejaba de contar, un convenio recién firmado caía a B0 y se lo
//     llevaba el asesor de B0 — el que menos contexto tenía de esa negociación.
//   · La reasignación de asesor: el convenio se lo queda su asesor.
//
// El modelo de medición NO cambió (se sigue usando para el log y para decidir
// el bucket de re-siembra de un convenio sin historial):
//   - En convenio el cliente paga AMBAS cosas cada mes: la cuota NORMAL del
//     crédito Y la del CONVENIO. El pago del convenio marca
//     `convenio_cuotas.fecha_pago` pero NO toca cuotas_credito, así que hay que
//     mirar las DOS fuentes o se sobre/sub-cuenta el atraso.
//   - Meses atrasados = fechas de vencimiento distintas, pasadas, con algo
//     impago, uniendo (A) cuotas del crédito no absorbidas por el convenio y
//     (B) cuotas del convenio posteriores al acuerdo y no cubiertas por monto.
// ============================================================
// ── Contexto que sigue valiendo ─────────────────────────────────────────────
// El motor de mora (`procesarMoras`/`latefee.ts`) EXCLUYE EN_CONVENIO
// (STATUS_EXCLUIDOS_MORA / STATUS_BUCKET_FUERA): no les genera mora, no cambia
// estado y NO les escribe transición de bucket. Por eso los EN_CONVENIO
// necesitan su propia fila en `buckets_historial` — sin ella no tienen bucket
// visible, y en COBROS-02 todo crédito que se gestiona tiene que estar en uno.
//
// Este job corre APARTE de procesarMoras (otro horario, otro advisory lock) y
// nunca lo pisa: procesarMoras escribe todos los demás estados, este solo
// EN_CONVENIO.
// ============================================================

// Clave del advisory lock — adyacente a la de procesarMoras (728193), distinta
// para que ambos jobs puedan correr sin bloquearse entre sí.

export type BucketsConvenioResultado = {
  skipped?: boolean;
  /** Créditos EN_CONVENIO revisados. */
  creditos: number;
  /** Cuántos no tenían bucket de su régimen y se congelaron acá (red de seguridad). */
  congelados: number;
  /** Cuántos tienen al menos un mes atrasado (solo informativo — avisa el CRM). */
  atrasados: number;
};

/**
 * Revisa los créditos EN_CONVENIO. NO mueve buckets ni reasigna asesores — eso
 * lo congela el convenio (decisión 9). Acá solo se hacen dos cosas:
 *
 *  1. Congelar el bucket de los que no tengan fila de su régimen de convenio
 *     (red de seguridad; el camino normal congela al firmar).
 *  2. Medir el atraso del convenio para el log. El aviso de convenio incumplido
 *     lo manda el CRM (Fase 1) leyendo `GET /convenio/alertas`.
 */
export async function procesarBucketsConvenio(): Promise<BucketsConvenioResultado> {
  const lockConn = await client.connect();
  let lockHeld = false;
  try {
    const _lk = await lockConn.query(
      "SELECT pg_try_advisory_lock($1) AS ok",
      [BUCKETS_CONVENIO_LOCK_KEY],
    );
    lockHeld = _lk.rows[0]?.ok === true;
    if (!lockHeld) {
      console.log(
        "[BUCKETS-CONV] ⏭️ Otra instancia ya está revisando los convenios; se omite.",
      );
      return { skipped: true, creditos: 0, congelados: 0, atrasados: 0 };
    }

    // El catálogo de buckets ya no hace falta: el bucket no se deriva de rangos
    // de cuotas, lo congela el convenio. Por lo mismo desapareció el guard de
    // "catálogo inconsistente" — no hay nada que este job pueda clasificar mal.
    const { creditoIds, mesesAtrasados, mesesUnion, convenioDesde } =
      await medirAtrasoDeConvenios();

    if (creditoIds.length === 0) {
      console.log("[BUCKETS-CONV] No hay créditos EN_CONVENIO — nada que revisar.");
      return { creditos: 0, congelados: 0, atrasados: 0 };
    }

    // Red de seguridad: congelar a los que no tengan fila de su régimen. El
    // camino normal congela al firmar (`createPaymentAgreement`); acá caen los
    // que llegaron por otra puerta. `congelarBucketPorConvenio` vuelve a
    // comprobarlo y no lanza, así que un crédito problemático no se lleva la
    // corrida completa.
    let congelados = 0;
    for (const creditoId of creditoIds) {
      // El corte por fecha acota la pregunta al convenio VIGENTE: la bitácora
      // es append-only, así que la fila de un convenio anterior haría creer
      // para siempre que este ya está congelado (review de Codex, P2).
      const desde = convenioDesde.get(creditoId) ?? null;
      if (await tieneBucketDeConvenio(creditoId, db, desde)) continue;
      const meses = mesesAtrasados.get(creditoId) ?? 0;
      const bucket = await bucketParaCongelarEnConvenio(creditoId, meses);
      const resultado = await congelarBucketPorConvenio({
        credito_id: creditoId,
        bucket,
        desde,
        motivo: `Convenio: congelado en B${bucket} por el vigilante (sin bucket de su régimen)`,
      });
      if (resultado !== null) congelados++;
    }

    const atrasados = [...mesesAtrasados.values()].filter((m) => m > 0).length;
    // Se loguean las DOS medidas a propósito: la diferencia entre ellas es
    // "cuántos pagan su convenio pero no su cuota normal", que es un dato de
    // negocio que hoy nadie está mirando (ver CriterioAtrasoConvenio).
    const debenAlgo = [...mesesUnion.values()].filter((m) => m > 0).length;

    console.log(
      `[BUCKETS-CONV] Créditos EN_CONVENIO: ${creditoIds.length} — congelados acá: ${congelados}, incumpliendo el convenio: ${atrasados}, debiendo algo (convenio o cuota normal): ${debenAlgo} (el aviso lo manda el CRM)`,
    );

    return { creditos: creditoIds.length, congelados, atrasados };
  } catch (err) {
    console.error("[BUCKETS-CONV] ⚠️ Error revisando los convenios:", err);
    throw err;
  } finally {
    if (lockHeld) {
      try {
        await lockConn.query("SELECT pg_advisory_unlock($1)", [
          BUCKETS_CONVENIO_LOCK_KEY,
        ]);
      } catch (unlockErr) {
        console.error("[BUCKETS-CONV] ⚠️ Error liberando advisory lock:", unlockErr);
      }
    }
    lockConn.release();
  }
}
