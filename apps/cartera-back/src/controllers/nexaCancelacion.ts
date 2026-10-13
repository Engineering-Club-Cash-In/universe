import { sql } from "drizzle-orm";
import type { db } from "../database/index";
import { SQL_CARTERA_SCHEMA } from "../database/db/schema";

type Executor = Pick<typeof db, "execute">;

/**
 * Un crédito CANCELADO nunca se reactiva: su token de Nexa se desactiva y se
 * anota el evento para nexa-server en la MISMA transacción de la cancelación.
 * Un solo statement: el evento nace solo si el UPDATE tocó una fila. Sin
 * binding (o ya inactivo) no hace nada. Devuelve true si desactivó.
 */
export async function desactivarNexaPorCancelacion(
  tx: Executor,
  creditoId: number,
): Promise<boolean> {
  const result = await tx.execute(sql`
    WITH desactivado AS (
      UPDATE ${SQL_CARTERA_SCHEMA}.nexa_credit_bindings
         SET activo = false
       WHERE credito_id = ${creditoId} AND activo
      RETURNING credito_id
    )
    INSERT INTO ${SQL_CARTERA_SCHEMA}.nexa_outbox (tipo, credito_id, payload)
    SELECT 'credit_cancelled', credito_id, jsonb_build_object('creditoId', credito_id)
      FROM desactivado
    RETURNING id
  `);
  return (result.rows?.length ?? 0) > 0;
}
