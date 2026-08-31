import { recalcularPagosCredito } from "./updateCredit";

/**
 * Refresca la proyección de las cuotas PENDIENTES después de una reversión.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ HACE FALTA
 *
 * Cuando un pago cierra una cuota, la validación pone en CERO los `*_restante`
 * de TODAS las filas de esa cuota (registerPayment.ts, rama "cuota completa"):
 * con la cuota pagada eso es correcto y limpia restantes huérfanos.
 *
 * Al reversar, la cuota vuelve a estar impaga, pero la reversión solo devuelve
 * a la fila del PAGO reversado lo que ese pago había abonado. La fila sembrada
 * —que quedó en cero y nunca tuvo abonos que devolver— se queda vacía: la cuota
 * termina "sin pagar y sin deber nada".
 *
 * Eso deja una cuota INVISIBLE: no cuenta como atrasada (no tiene monto) y no
 * se puede cobrar (saldo 0). Un pago posterior a esa cuota tampoco se aplica —
 * `insertPayment` distribuye con `min(saldo de la fila, …)`, así que con la
 * fila en cero el dinero se corre a la siguiente cuota. Caso real reproducido
 * en dev (crédito 9266): tras pruebas de pago + reversa, las cuotas 1-3
 * quedaron en cero y el bot de cobros le dijo al cliente "estás al día" con una
 * cuota vencida hacía 16 días.
 *
 * Hasta hoy esto se arreglaba a mano con el botón "Recalcular Pagos" — el
 * comentario de reversePayment lo daba por hecho ("se refresca por el flujo
 * normal o el botón manual"). Eso alcanzaba cuando el único lector era un
 * humano mirando la ficha; ya no, con el bot y los links de pago leyendo ese
 * estado intermedio.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POR QUÉ **SIN** `numero_cuota`
 *
 * `recalcularPagosCredito` sin `numero_cuota` toca SOLO lo que todavía no se
 * aplicó al crédito: cuotas no pagadas y pagos registrados sin validar. La
 * historia liquidada no se toca.
 *
 * Pasarle `numero_cuota` haría lo contrario —recalcula "desde esa cuota en
 * adelante, pagadas y no pagadas"—, que es exactamente el clavo del
 * `updateInstallments({ all: true })` que vivía acá hasta que se quitó: en cada
 * reversión reescribía las cuotas ya pagadas (restantes teóricos, cuota actual
 * y membresías en 0) y corrompía la historia liquidada.
 */

/** INCOBRABLE queda fuera: su calendario es el del insoluto, no una amortización. */
const ESTADOS_SIN_RECALCULO = new Set(["INCOBRABLE"]);

export type RefrescarProyeccionInput = {
  numeroCreditoSifco: string | null | undefined;
  statusCredit: string | null | undefined;
  /** Inyectable para test; por defecto el recálculo real. */
  recalcular?: typeof recalcularPagosCredito;
};

export type ResultadoRefresco =
  | { corrio: true }
  | { corrio: false; motivo: "incobrable" | "sin_sifco" | "error" };

/**
 * Nunca lanza: la reversión ya está firme cuando esto corre. Si el recálculo
 * falla, el crédito queda como quedaba antes de este cambio (la proyección se
 * refresca con el próximo pago o con el botón manual) — nunca peor.
 */
export async function refrescarProyeccionTrasReversa({
  numeroCreditoSifco,
  statusCredit,
  recalcular = recalcularPagosCredito,
}: RefrescarProyeccionInput): Promise<ResultadoRefresco> {
  if (statusCredit && ESTADOS_SIN_RECALCULO.has(statusCredit)) {
    return { corrio: false, motivo: "incobrable" };
  }
  if (!numeroCreditoSifco) {
    return { corrio: false, motivo: "sin_sifco" };
  }

  try {
    await recalcular({ numero_credito_sifco: numeroCreditoSifco });
    return { corrio: true };
  } catch (error) {
    console.error(
      `⚠️ Reversa: no se pudo refrescar la proyección del crédito ${numeroCreditoSifco} (la reversión SÍ quedó firme):`,
      error instanceof Error ? error.message : error,
    );
    return { corrio: false, motivo: "error" };
  }
}
