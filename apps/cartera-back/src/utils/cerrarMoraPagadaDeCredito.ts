import { and, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { compensarAnotacionesVivas } from "./anotarMoraPagada";
import { mora_pagada_cuota } from "../database/db/schema";

/**
 * Cierra el contador de mora de un crédito compensando todas sus anotaciones vivas.
 *
 * ── Por qué existe ──────────────────────────────────────────────────────────
 * Cuando se rompe un convenio, la mora debe recalcularse DESDE CERO sobre la
 * base nueva (capital e cuotas atrasadas del momento de la ruptura). Si se
 * arrastrara la mora pagada anterior, se le estaría regalando al cliente mora
 * que ya no corresponde a esa base. El cierre compensa todas las anotaciones
 * vivas para que el nuevo cálculo arranque con saldo cero.
 *
 * ── La diferencia con revertirMoraPagadaDePago ────────────────────────────
 * `revertirMoraPagadaDePago` compensa lo que UN PAGO abonó a mora (una o varias
 * cuotas, pero todas del mismo pago). `cerrarMoraPagadaDeCredito` compensa TODAS
 * las anotaciones vivas del crédito, sin importar cuál pago las causó, porque el
 * convenio que se rompe puede haber tenido múltiples pagos con mora abonada.
 *
 * ── Por qué la tabla es de solo agregar ─────────────────────────────────────
 * Acá nunca se hace UPDATE ni DELETE. Compensar INSERTA una fila negativa que
 * apunta a la original por `revierte_a`. Así el saldo es siempre `SUM(monto)`,
 * la reversa es exacta —se devuelve justo lo que se pagó— y queda el rastro de
 * los dos hechos: los pagos originales y la compensación por ruptura de convenio.
 */

type Ejecutor = NodePgDatabase<any>;

/**
 * Compensa todas las anotaciones vivas de mora de un crédito.
 *
 * Va SIEMPRE dentro de la transacción que rompe el convenio: si el cierre falla,
 * la ruptura no debe pasar. Un convenio roto cuya mora no quedó compensada dejaría
 * al cliente con un saldo de mora inflado que corresponde a la base anterior.
 *
 * Devuelve cuántas filas compensó. Cero significa que el crédito no tenía ninguna
 * anotación viva de mora: es una situación legítima y por eso no lanza.
 */
export async function cerrarMoraPagadaDeCredito(
  params: {
    credito_id: number;
    usuario_id?: number | null;
  },
  ejecutor: Ejecutor,
): Promise<number> {
  return compensarAnotacionesVivas(
    // Solo las positivas: una compensatoria nunca se vuelve a compensar.
    and(
      eq(mora_pagada_cuota.credito_id, params.credito_id),
      inArray(mora_pagada_cuota.tipo, ["PAGO", "CONDONACION"]),
    )!,
    { tipo: "REVERSA", usuario_id: params.usuario_id, motivo: "Cierre de mora por ruptura de convenio de pago" },
    ejecutor,
  );
}
