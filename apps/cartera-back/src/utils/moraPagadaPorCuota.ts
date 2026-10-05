import Big from "big.js";
import { eq, inArray, sum } from "drizzle-orm";
import { mora_pagada_cuota } from "../database/db/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

/**
 * Carga lo que ya se pagó de mora para cada cuota.
 *
 * Suma `monto` de `cartera.mora_pagada_cuota` agrupando por `cuota_id`,
 * solo para los `cuotaIds` pedidos.
 *
 * Si `cuotaIds` viene vacío, devuelve un Map vacío sin consultar la BD.
 *
 * Una cuota sin filas no aparece en el Map; quien lea trata la ausencia como cero.
 *
 * @param cuotaIds - Array de IDs de cuota a consultar
 * @param db - Instancia de base de datos Drizzle
 * @returns Map<cuota_id, monto_pagado>
 */
export async function moraPagadaPorCuota(
  cuotaIds: number[],
  db: NodePgDatabase<any>,
): Promise<Map<number, Big>> {
  const resultado = new Map<number, Big>();

  // Si no hay cuotas, no hay nada que consultar
  if (cuotaIds.length === 0) {
    return resultado;
  }

  // Consultar: suma de monto agrupada por cuota_id
  const filas = await db
    .select({
      cuota_id: mora_pagada_cuota.cuota_id,
      total: sum(mora_pagada_cuota.monto),
    })
    .from(mora_pagada_cuota)
    .where(inArray(mora_pagada_cuota.cuota_id, cuotaIds))
    .groupBy(mora_pagada_cuota.cuota_id);

  // Convertir a Map
  for (const fila of filas) {
    if (fila.total !== null) {
      resultado.set(fila.cuota_id, new Big(fila.total));
    }
  }

  return resultado;
}
