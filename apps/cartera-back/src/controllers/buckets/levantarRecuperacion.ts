import { and, eq, sql } from "drizzle-orm";
import { db } from "../../database";
import { creditos, moras_credito, SQL_CARTERA_SCHEMA } from "../../database/db/schema";
import { contarCuotasVencidasReales, STATUS_EN_JURIDICO, STATUS_EN_RECUPERACION } from "../latefee";

// ─────────────────────────────────────────────────────────────────────────────
// COBROS-02 · Fase 4 — LEVANTAR el estado `EN_RECUPERACION`.
//
// Decisión 5 del plan 08: el estado se levanta solo si el cliente paga **el
// total de lo que debe, sin convenio**, y se evalúa al **validarse** el pago —
// no al registrarlo. Una boleta se sube hoy y contabilidad la valida después;
// levantar en el registro sería creerle a un comprobante que nadie miró.
//
// Decisión 18: "el total" **incluye la mora**. Si pagó todas las cuotas pero
// quedó debiendo el recargo, NO sale de recuperación. La condición es que no
// deba nada: ni cuotas vencidas ni mora.
//
// Lo que NO levanta el estado, y es a propósito:
//  · Un pago del CONVENIO (decisión 4). No hace falta excluirlo acá: un crédito
//    en convenio tiene `statusCredit = 'EN_CONVENIO'`, no `EN_RECUPERACION`, así
//    que la condición de abajo ni se evalúa.
//  · Condonar la mora. Eso baja el monto a 0 sin que el cliente pague, y por eso
//    la condonación respeta `STATUS_NO_PISAR` en vez de llamar a esto.
//  · La corrida nocturna del motor. El estado lo puso una persona y lo levanta
//    un pago validado, no un recálculo.
// ─────────────────────────────────────────────────────────────────────────────

type Ejecutor = Pick<typeof db, "select" | "update" | "execute">;

/**
 * Corre `trabajo` en un SAVEPOINT cuando el ejecutor es una transacción (la de la
 * reversa). Un query que falla deja abortada la transacción de PostgreSQL aunque
 * el JS lo atrape: sin savepoint, el "best-effort" de estos helpers rompería el
 * commit de la reversa financiera. Con savepoint, el fallo solo deshace el
 * trabajo opcional. Un ejecutor sin `transaction` (la conexión suelta) no lo necesita.
 */
export async function enSavepoint<T>(
  ejecutor: unknown,
  trabajo: (e: Ejecutor) => Promise<T>,
): Promise<T> {
  const conTransaccion = ejecutor as {
    transaction?: (fn: (e: Ejecutor) => Promise<T>) => Promise<T>;
  };
  if (typeof conTransaccion.transaction === "function") {
    return conTransaccion.transaction((sp) => trabajo(sp));
  }
  return trabajo(ejecutor as Ejecutor);
}

/**
 * Estados que la recuperación puede reemplazar al restaurarse.
 *
 * Son los que el levantamiento pudo haber dejado: `ACTIVO` (no debía nada) y
 * `MOROSO` (el motor lo movió después). Cualquier otro —`EN_CONVENIO`,
 * `INCOBRABLE`, una cancelación— es una decisión POSTERIOR a la recuperación y
 * más específica que ella: restaurar encima sería deshacerla.
 */
const ESTADOS_QUE_LA_RECUPERACION_PUEDE_REEMPLAZAR = [
  "ACTIVO",
  "MOROSO",
] as const;

export type LevantamientoRecuperacion = {
  /** true si el crédito salió de EN_RECUPERACION en esta llamada. */
  levantado: boolean;
  /** Por qué NO se levantó (null si se levantó o si no aplicaba). */
  motivo?: "no_estaba_en_recuperacion" | "debe_cuotas" | "debe_mora";
};

/**
 * Levanta `EN_RECUPERACION` si el crédito ya no debe nada. Idempotente y
 * silenciosa: si el crédito no está en ese estado, no hace nada.
 *
 * Corre DENTRO de la transacción del pago que la dispara: si el pago se revierte,
 * el levantamiento también. Por eso recibe el ejecutor y no usa `db` directo.
 */
export async function levantarRecuperacionSiPagoTodo(
  credito_id: number,
  ejecutor: Ejecutor = db,
  /**
   * El pago cuya validación lo levanta. Se GUARDA en el crédito para poder
   * devolver el estado si ese pago se reversa (ver
   * `restaurarRecuperacionSiEstePagoLaLevanto`). Sin él el levantamiento
   * funciona igual, pero deja de ser reversible.
   */
  pago_id?: number,
): Promise<LevantamientoRecuperacion> {
  const [credito] = await ejecutor
    .select({ statusCredit: creditos.statusCredit })
    .from(creditos)
    .where(eq(creditos.credito_id, credito_id))
    .limit(1);

  // COBROS-02 W3: Jurídico se levanta con la misma regla que la recuperación.
  const estadoLeido = credito?.statusCredit ?? null;
  if (estadoLeido !== STATUS_EN_RECUPERACION && estadoLeido !== STATUS_EN_JURIDICO) {
    return { levantado: false, motivo: "no_estaba_en_recuperacion" };
  }
  const esJuridico = estadoLeido === STATUS_EN_JURIDICO;

  // Cuotas vencidas REALES en este instante (el mismo predicado del motor: sin
  // pagar y sin pago validado que haya aplicado plata). No se usa
  // `moras_credito.cuotas_atrasadas` porque es una FOTO de la última corrida.
  const cuotasVencidas = await contarCuotasVencidasReales(
    credito_id,
    estadoLeido,
    ejecutor as never,
  );
  if (cuotasVencidas > 0) return { levantado: false, motivo: "debe_cuotas" };

  // Decisión 18: la mora cuenta. `monto_mora > 0` con la mora activa = todavía
  // debe el recargo, aunque no le quede ninguna cuota vencida.
  const [mora] = await ejecutor
    .select({ monto: moras_credito.monto_mora })
    .from(moras_credito)
    .where(
      and(
        eq(moras_credito.credito_id, credito_id),
        eq(moras_credito.activa, true),
      ),
    )
    .limit(1);
  if (mora && Number(mora.monto) > 0) {
    return { levantado: false, motivo: "debe_mora" };
  }

  // El UPDATE es condicional sobre el MISMO estado que se leyó arriba: entre la
  // lectura y la escritura otra transacción pudo cambiarlo (un convenio nuevo,
  // una cancelación), y pisarlo desharía una decisión más reciente.
  await ejecutor
    .update(creditos)
    .set(
      esJuridico
        ? {
            statusCredit: "ACTIVO",
            // Provenance del levantamiento de Jurídico (W3), igual que el de
            // recuperación: si ese pago se reversa, el crédito vuelve a Jurídico.
            juridico_levantada_pago_id: pago_id ?? null,
          }
        : {
            statusCredit: "ACTIVO",
            // Provenance: qué pago lo levantó. Es lo único que permite devolverle el
            // estado si ese pago se reversa — sin esto, la decisión humana y su piso
            // en B4 se pierden en silencio (review de Codex, P1).
            recuperacion_levantada_pago_id: pago_id ?? null,
          },
    )
    .where(
      and(
        eq(creditos.credito_id, credito_id),
        eq(creditos.statusCredit, estadoLeido),
      ),
    );

  // El bucket NO se toca acá. Sin el estado ya no hay piso, así que la corrida
  // de las 00:05 lo devuelve a donde le corresponde por cuotas —B0, porque no
  // debe nada— y deja su BAJADA en la bitácora. Escribirla desde acá duplicaría
  // el evento y competiría con el motor por la misma fila.
  return { levantado: true };
}

/**
 * La vuelta atrás: si el pago que se está reversando es EL que levantó la
 * recuperación, el crédito vuelve a `EN_RECUPERACION`.
 *
 * Por qué hace falta. `reversePayment` restaura cuotas, capital y mora, pero el
 * status queda `ACTIVO`: la corrida nocturna a lo sumo lo pone `MOROSO`, así
 * que la decisión humana —y con ella el piso en B4— se perdía para siempre sin
 * que nadie se entere (review de Codex, P1). Es el mismo criterio con el que la
 * reversa "des-completa" un convenio y devuelve el crédito a `EN_CONVENIO`.
 *
 * Solo actúa sobre el crédito que guarda ESE `pago_id`: reversar cualquier otro
 * pago no resucita una recuperación que se levantó con otro.
 *
 * No lanza: una reversa no puede fallar por esto.
 */
export async function restaurarRecuperacionSiEstePagoLaLevanto(
  credito_id: number,
  pago_id: number,
  ejecutor: Ejecutor = db,
): Promise<boolean> {
  try {
    return await enSavepoint(ejecutor, (ejecutor) => restaurarRecuperacionEn(credito_id, pago_id, ejecutor));
  } catch (err) {
    console.error(
      `[RECUPERACION] ⚠️ No se pudo devolver EN_RECUPERACION al crédito ${credito_id}:`,
      err,
    );
    return false;
  }
}

async function restaurarRecuperacionEn(
  credito_id: number,
  pago_id: number,
  ejecutor: Ejecutor,
): Promise<boolean> {
  {
    const [credito] = await ejecutor
      .select({
        statusCredit: creditos.statusCredit,
        levantadaPor: creditos.recuperacion_levantada_pago_id,
      })
      .from(creditos)
      .where(eq(creditos.credito_id, credito_id))
      .limit(1);

    if (!credito || credito.levantadaPor !== pago_id) return false;

    // La restauración solo puede reemplazar estados que la recuperación TIENE
    // DERECHO a reemplazar (review de Codex, P1).
    //
    // Comparar contra "el estado que acabo de leer" no alcanzaba: si el crédito
    // entró a un convenio o lo castigaron como incobrable después del
    // levantamiento —los dos son estados que `reversePaymentPolicy` admite—,
    // ese régimen es MÁS NUEVO que la recuperación y pisarlo sería deshacer una
    // decisión posterior con una anterior. La lista blanca lo dice explícito en
    // vez de depender de una comparación que casualmente coincidía.
    if (!ESTADOS_QUE_LA_RECUPERACION_PUEDE_REEMPLAZAR.includes(
      (credito.statusCredit ?? "") as (typeof ESTADOS_QUE_LA_RECUPERACION_PUEDE_REEMPLAZAR)[number],
    )) {
      // La marca se limpia igual: ese pago ya no puede restaurar nada, y
      // dejarla puesta haría que una reversa futura lo intentara de nuevo.
      await ejecutor
        .update(creditos)
        .set({ recuperacion_levantada_pago_id: null })
        .where(eq(creditos.credito_id, credito_id));
      return false;
    }

    // El UPDATE sigue siendo condicional sobre el estado leído, para que una
    // transición que ocurra entre la lectura y la escritura tampoco se pise.
    await ejecutor
      .update(creditos)
      .set({
        statusCredit: STATUS_EN_RECUPERACION,
        recuperacion_levantada_pago_id: null,
      })
      .where(
        and(
          eq(creditos.credito_id, credito_id),
          eq(creditos.statusCredit, credito.statusCredit ?? "ACTIVO"),
        ),
      );
    return true;
  }
}

/**
 * COBROS-02 W3 · La vuelta atrás de Jurídico: si el pago que se reversa fue EL
 * que levantó `EN_JURIDICO`, el crédito vuelve a Jurídico (y a su piso de B5).
 * Mismo criterio que `restaurarRecuperacionSiEstePagoLaLevanto`. Solo restaura
 * sobre estados que el levantamiento pudo dejar (ACTIVO, MOROSO): un régimen
 * posterior (convenio, incobrable, cancelación) no se pisa. No lanza.
 */
export async function restaurarJuridicoSiEstePagoLoLevanto(
  credito_id: number,
  pago_id: number,
  ejecutor: Ejecutor = db,
): Promise<boolean> {
  try {
    return await enSavepoint(ejecutor, (ejecutor) => restaurarJuridicoEn(credito_id, pago_id, ejecutor));
  } catch (err) {
    console.error(
      `[JURIDICO] ⚠️ No se pudo devolver EN_JURIDICO al crédito ${credito_id}:`,
      err,
    );
    return false;
  }
}

async function restaurarJuridicoEn(
  credito_id: number,
  pago_id: number,
  ejecutor: Ejecutor,
): Promise<boolean> {
  {
    const [credito] = await ejecutor
      .select({
        statusCredit: creditos.statusCredit,
        levantadaPor: creditos.juridico_levantada_pago_id,
      })
      .from(creditos)
      .where(eq(creditos.credito_id, credito_id))
      .limit(1);

    if (!credito || credito.levantadaPor !== pago_id) return false;

    if (!(ESTADOS_QUE_LA_RECUPERACION_PUEDE_REEMPLAZAR as readonly string[]).includes(credito.statusCredit ?? "")) {
      // La marca se limpia: ese pago ya no puede restaurar nada.
      await ejecutor
        .update(creditos)
        .set({ juridico_levantada_pago_id: null })
        .where(eq(creditos.credito_id, credito_id));
      return false;
    }

    await ejecutor
      .update(creditos)
      .set({ statusCredit: STATUS_EN_JURIDICO, juridico_levantada_pago_id: null })
      .where(
        and(
          eq(creditos.credito_id, credito_id),
          eq(creditos.statusCredit, credito.statusCredit ?? "ACTIVO"),
        ),
      );
    // El piso lo vuelve a B5: el asesor también tiene que ser del pool de B5.
    // Import dinámico: juridico.ts arrastra el motor de buckets y este módulo
    // se carga también desde rutas que no lo necesitan.
    const { reasignarAsesorDeJuridicoSiHaceFalta } = await import("./juridico");
    await reasignarAsesorDeJuridicoSiHaceFalta(
      credito_id,
      `Jurídico reinstalado por la reversa del pago ${pago_id}`,
      ejecutor as never,
    );
    return true;
  }
}
