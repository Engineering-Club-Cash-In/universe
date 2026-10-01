import Big from "big.js";
import { eq, inArray, sql } from "drizzle-orm";
import { mora_pagada_cuota } from "../database/db/schema";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { alias } from "drizzle-orm/pg-core";

/**
 * Fila cruda de mora_pagada_cuota con el tipo del origen
 * (propio si es PAGO/CONDONACION, o del revierte_a si es REVERSA/ANULACION).
 */
export interface FilasMoraConOrigen {
  monto: string;
  tipo: string;
  tipo_origen: string | null;
}

/**
 * Clasifica filas de mora_pagada_cuota por su ORIGEN:
 * - Filas PAGO o CONDONACION → usar su propio tipo
 * - Filas REVERSA o ANULACION → usar el tipo del que revierte (tipo_origen)
 *
 * Las REVERSA/ANULACION son compensatorias: su monto es negativo.
 *
 * @param filas - Array de filas con tipo, tipo_origen, y monto
 * @returns { pagada, condonada }
 */
export function clasificarPorOrigen(
  filas: FilasMoraConOrigen[]
): {
  pagada: Big;
  condonada: Big;
} {
  let pagada = new Big(0);
  let condonada = new Big(0);

  for (const fila of filas) {
    const monto = new Big(fila.monto);
    // Para REVERSA/ANULACION, usar el tipo del que revierte; para PAGO/CONDONACION, el propio
    const origen = fila.tipo_origen ?? fila.tipo;

    if (origen === "PAGO") {
      pagada = pagada.plus(monto);
    } else if (origen === "CONDONACION") {
      condonada = condonada.plus(monto);
    }
  }

  return { pagada, condonada };
}

/**
 * Carga lo que ya se pagó y condonó de mora para un conjunto de cuotas,
 * diferenciando entre pagos reales (PAGO) y condonaciones (CONDONACION).
 *
 * REVERSA y ANULACION se clasifican por el tipo de la fila que revierten:
 * si revierten un PAGO, restan de pagada; si revierten una CONDONACION, restan de condonada.
 *
 * Una sola consulta: LEFT JOIN de la tabla consigo misma por revierte_a,
 * SELECT con COALESCE para el tipo del origen, sin GROUP BY (devuelve filas crudas).
 *
 * Si `cuotaIds` viene vacío, devuelve {pagada: 0, condonada: 0} sin consultar.
 *
 * @param cuotaIds - Array de IDs de cuota a consultar
 * @param db - Instancia de base de datos Drizzle
 * @returns { pagada, condonada }
 */
export async function moraAbonadaPorOrigen(
  cuotaIds: number[],
  db: NodePgDatabase<any>
): Promise<{ pagada: Big; condonada: Big }> {
  // Si no hay cuotas, no hay nada que consultar
  if (cuotaIds.length === 0) {
    return { pagada: new Big(0), condonada: new Big(0) };
  }

  // Cada fila con el tipo de su ORIGEN: el propio, o el de la fila que
  // compensa (auto-unión por `revierte_a`). Constructor de drizzle y no SQL
  // crudo a propósito: un arreglo JS dentro de sql`` se expande a
  // `($1, $2, …)`, y `ANY(($1, $2)::integer[])` revienta en Postgres.
  const orig = alias(mora_pagada_cuota, "orig");
  const filas: FilasMoraConOrigen[] = await db
    .select({
      monto: mora_pagada_cuota.monto,
      tipo: mora_pagada_cuota.tipo,
      tipo_origen: sql<string | null>`COALESCE(${orig.tipo}, ${mora_pagada_cuota.tipo})`,
    })
    .from(mora_pagada_cuota)
    .leftJoin(orig, eq(mora_pagada_cuota.revierte_a, orig.id))
    .where(inArray(mora_pagada_cuota.cuota_id, cuotaIds));

  return clasificarPorOrigen(filas);
}
