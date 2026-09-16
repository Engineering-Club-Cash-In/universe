import { desc, eq } from "drizzle-orm";
import { db } from "../database";
import {
  convenios_pago,
  convenios_pagos_resume,
} from "../database/db/schema";

// Módulo aparte, y no dentro de reversePayment.ts, a propósito: aquel arrastra
// medio cartera en sus imports (SAT, inversionistas, recálculos) y las pruebas
// que mockean esos módulos a nivel global rompían la carga de cualquier otra
// que lo importara. Esto solo necesita dos tablas.

/**
 * El convenio al que se le acreditó un pago, del criterio más exacto al menos.
 *
 *  1. El SELLO de la fila (`pagos_credito.convenio_id`). Lo escribe el mismo
 *     estampador que el monto, en el mismo acto, así que es la respuesta
 *     exacta para todo pago registrado desde que existe la columna.
 *  2. El pivot `convenios_pagos_resume`. Exacto cuando acierta, pero solo
 *     tiene las filas PRE-SEMBRADAS que el convenio reestructuró al crearse:
 *     los pagos acreditados después caen en otras filas. En el sandbox, 196 de
 *     204 pagos con `pago_convenio > 0` no tienen fila ahí (review de Codex,
 *     P1) — por eso dejó de ser el criterio principal.
 *  3. El convenio MÁS RECIENTE del crédito, anulados incluidos. Solo para
 *     pagos viejos sin sello ni pivot. Es exacto salvo en un caso: crédito con
 *     varios convenios y un pago viejo del anterior (2 créditos en el sandbox).
 *
 * Por qué el respaldo NO excluye los anulados (y la ronda anterior sí): la
 * reversa tiene que descontarle el monto al convenio que lo recibió, y si ese
 * convenio se deshizo sigue siendo el que lo recibió. Excluirlo hacía fallar la
 * reversa entera ("no se encontró un convenio") o, si ya había otro firmado,
 * le descontaba a ese. La anulación se preserva más abajo, al escribir.
 */
export async function convenioQueRecibioElPago(
  params: { credito_id: number; pago_id: number; convenio_id?: number | null },
  ejecutor: Pick<typeof db, "select"> = db,
) {
  const porId = (convenio_id: number) =>
    ejecutor
      .select()
      .from(convenios_pago)
      .where(eq(convenios_pago.convenio_id, convenio_id))
      .limit(1);

  if (params.convenio_id) {
    const [sellado] = await porId(params.convenio_id);
    if (sellado) return sellado;
  }

  const [porPivot] = await ejecutor
    .select({ convenio_id: convenios_pagos_resume.convenio_id })
    .from(convenios_pagos_resume)
    .where(eq(convenios_pagos_resume.pago_id, params.pago_id))
    .limit(1);
  if (porPivot) {
    const [delPivot] = await porId(porPivot.convenio_id);
    if (delPivot) return delPivot;
  }

  const [masReciente] = await ejecutor
    .select()
    .from(convenios_pago)
    .where(eq(convenios_pago.credito_id, params.credito_id))
    .orderBy(desc(convenios_pago.created_at), desc(convenios_pago.convenio_id))
    .limit(1);
  return masReciente;
}

