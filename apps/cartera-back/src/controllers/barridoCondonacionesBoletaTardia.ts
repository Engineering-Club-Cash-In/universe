import { sql } from "drizzle-orm";
import { db } from "../database";
import { tryWithPaymentAdvisoryLock } from "../utils/paymentAdvisoryLock";
import { anularCondonacionBoletaTardia } from "./latefee";

/**
 * Barrido de condonaciones de boleta tardía HUÉRFANAS: el proceso murió entre condonar y registrar el pago, y sin
 * esto la mora se pierde (el cron respeta el ledger). Anula las vivas de entre 15 minutos y 24 horas sin ninguna fila
 * de pago viva con su intento EN ESE crédito. Las de más de 24 h NO se tocan (restituir mora días después sería
 * sorprender al cliente): se loguean para revisión manual. Las de Nexa y las manuales (`intento_id` NULL) jamás.
 *
 * `reactivarMora: false` a propósito: nunca hubo un pago que apagara la mora; si el cron la apagó mientras tanto, la
 * recalcula esta noche desde el ledger, que la anulación ya compensó.
 *
 * Concurrencia: cada candidata se decide BAJO el advisory lock del crédito (el mismo que sostiene /newPayment entre
 * condonar e insertPayment) y la ausencia de filas se re-verifica adentro. El umbral de 15 min solo no basta.
 * El lock se pide con TRY (nunca espera): un pago colgado no frena el job ni agota lockPool; esa candidata se omite
 * y se reintenta en la corrida siguiente. Una bandera de módulo evita que dos corridas se solapen.
 *
 * Falsos positivos: si el crédito tiene filas vivas SIN marca de intento creadas después de la condonación
 * (recalculateFromJson, resetCredit, caída a incobrable las reconstruyen sin marca) NO se anula: revisión manual.
 *
 * Limitación (E-15): las condonaciones vivas cuyo registro dejó el log `verificacion_fallida` NO son detectables por
 * dato (solo queda el log en boletaTardia.ts); no hay columna ni motivo persistido. Tienen filas vivas, así que el
 * barrido no las toca; se rastrean por ese log.
 */
export const MINUTOS_GRACIA_CONDONACION_HUERFANA = 15;
export const HORAS_MAXIMAS_CONDONACION_HUERFANA = 24;
const LOTE = 200;

type Candidata = { condonacion_id: number; credito_id: number; intento_id: string };

export type DepsBarrido = {
  candidatas: () => Promise<Candidata[]>;
  /** Huérfanas de más de 24 h: solo se loguean. */
  abandonadas: () => Promise<Candidata[]>;
  sinFilasVivas: (credito_id: number, intento_id: string) => Promise<boolean>;
  /** ¿Hay filas vivas del crédito sin marca de intento, creadas desde que se condonó? */
  filasSinMarca: (condonacion_id: number) => Promise<boolean>;
  conLock: typeof tryWithPaymentAdvisoryLock;
  anular: typeof anularCondonacionBoletaTardia;
};

const filas = <T>(r: unknown): T[] => (Array.isArray(r) ? r : (r as { rows?: T[] }).rows ?? []) as T[];

// `fecha` es timestamp sin zona con DEFAULT now(): se compara en SQL, no en JS (postgres.js la correría +6h).
const huerfanas = (rango: ReturnType<typeof sql>) => async (): Promise<Candidata[]> =>
  filas<Candidata>(await db.execute(sql`
    SELECT mc.condonacion_id, mc.credito_id, mc.intento_id::text AS intento_id
    FROM cartera.moras_condonaciones mc
    WHERE mc.anulada_at IS NULL AND mc.intento_id IS NOT NULL ${rango}
      AND NOT EXISTS (SELECT 1 FROM cartera.pagos_credito p
        WHERE p.boleta_tardia_intento_id = mc.intento_id AND p.credito_id = mc.credito_id AND p."paymentFalse" = false)
    ORDER BY mc.condonacion_id LIMIT ${LOTE}`));

export const depsBarridoReales = (): DepsBarrido => ({
  candidatas: huerfanas(sql`
      AND mc.fecha < now() - make_interval(mins => ${MINUTOS_GRACIA_CONDONACION_HUERFANA})
      AND mc.fecha > now() - make_interval(hours => ${HORAS_MAXIMAS_CONDONACION_HUERFANA})`),
  // Solo la franja (24 h, 24 h + 15 min]: se avisa una vez, no en cada corrida.
  abandonadas: huerfanas(sql`
      AND mc.fecha <= now() - make_interval(hours => ${HORAS_MAXIMAS_CONDONACION_HUERFANA})
      AND mc.fecha > now() - make_interval(hours => ${HORAS_MAXIMAS_CONDONACION_HUERFANA}, mins => ${MINUTOS_GRACIA_CONDONACION_HUERFANA})`),
  filasSinMarca: async (condonacion_id) => {
    const [r] = filas<{ hay: boolean }>(await db.execute(sql`
      SELECT EXISTS (SELECT 1 FROM cartera.moras_condonaciones mc
        JOIN cartera.pagos_credito p ON p.credito_id = mc.credito_id
        WHERE mc.condonacion_id = ${condonacion_id} AND p."paymentFalse" = false
          AND p.boleta_tardia_intento_id IS NULL AND p.createdat >= mc.fecha) AS hay`));
    return r?.hay === true;
  },
  sinFilasVivas: async (credito_id, intento_id) => {
    const [r] = filas<{ sin_filas: boolean }>(await db.execute(sql`
      SELECT NOT EXISTS (SELECT 1 FROM cartera.pagos_credito p
        WHERE p.boleta_tardia_intento_id = ${intento_id}::uuid AND p.credito_id = ${credito_id} AND p."paymentFalse" = false) AS sin_filas`));
    return r?.sin_filas === true;
  },
  conLock: tryWithPaymentAdvisoryLock,
  anular: anularCondonacionBoletaTardia,
});

let enCurso = false;

export async function barrerCondonacionesBoletaTardiaHuerfanas(deps: DepsBarrido = depsBarridoReales()) {
  const resultado = {
    revisadas: 0, anuladas: 0, omitidas: 0, fallidas: 0,
    omitidas_por_lock: 0, revision_manual: 0, abandonadas_nuevas: 0, solapada: false,
  };
  if (enCurso) {
    console.warn(JSON.stringify({ level: "warn", event: "boleta_tardia.barrido_solapado" }));
    return { ...resultado, solapada: true };
  }
  enCurso = true;
  try {
    const candidatas = await deps.candidatas();
    resultado.revisadas = candidatas.length;
    for (const c of candidatas) {
      try {
        const lock = await deps.conLock(c.credito_id, async () => {
          // Un /newPayment pudo terminar de escribir entre la lectura y el lock: se re-verifica ADENTRO.
          if (!(await deps.sinFilasVivas(c.credito_id, c.intento_id))) { resultado.omitidas++; return; }
          if (await deps.filasSinMarca(c.condonacion_id)) {
            resultado.revision_manual++;
            console.warn(JSON.stringify({ level: "warn", event: "boleta_tardia.condonacion_huerfana_revision_manual", ...c }));
            return;
          }
          const r = await deps.anular({
            condonacion_id: c.condonacion_id,
            motivo: `Barrido: condonación de boleta tardía sin pago registrado tras ${MINUTOS_GRACIA_CONDONACION_HUERFANA} minutos`,
            reactivarMora: false,
          });
          if (r.anulada) {
            resultado.anuladas++;
            console.warn(JSON.stringify({
              level: "warn",
              event: r.restituida === false ? "boleta_tardia.condonacion_huerfana_anulada_sin_restituir" : "boleta_tardia.condonacion_huerfana_anulada",
              ...c, monto_restituido: r.monto,
            }));
          } else resultado.omitidas++;
        });
        if (!lock.adquirido) resultado.omitidas_por_lock++;
      } catch (error) {
        resultado.fallidas++;
        console.error(JSON.stringify({ level: "error", event: "boleta_tardia.barrido_fallo", ...c, error: error instanceof Error ? error.message : String(error) }));
      }
    }
    try {
      for (const c of await deps.abandonadas()) {
        resultado.abandonadas_nuevas++;
        console.warn(JSON.stringify({ level: "warn", event: "boleta_tardia.condonacion_huerfana_abandonada", ...c, nota: `más de ${HORAS_MAXIMAS_CONDONACION_HUERFANA} h: revisar a mano` }));
      }
    } catch (error) {
      console.error(JSON.stringify({ level: "error", event: "boleta_tardia.abandonadas_fallo", error: error instanceof Error ? error.message : String(error) }));
    }
    return resultado;
  } finally {
    enCurso = false;
  }
}
