import { sql } from "drizzle-orm";
import { db } from "../database";

type DbOrTx = typeof db;

export async function withAuditContext<T>(
  userId: number,
  fn: (tx: DbOrTx) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql.raw(`SET LOCAL app.current_user_id = '${Number(userId)}'`));
    return fn(tx as unknown as DbOrTx);
  });
}

/**
 * Contexto para el trigger trg_historial_capital_credito (ver drizzle/0014).
 * Setea, dentro de una transacción, las GUCs que el trigger lee para etiquetar
 * un cambio de creditos.capital: usuario, fuente y motivo. Usa set_config con
 * parámetros ligados (no interpolación) para que el `motivo` de texto libre sea
 * seguro ante inyección. Ejecuta `fn` con la MISMA transacción para que el
 * UPDATE dispare el trigger con las GUCs ya seteadas.
 */
export async function withCapitalContext<T>(
  userId: number | null | undefined,
  source: string,
  motivo: string | null | undefined,
  fn: (tx: DbOrTx) => Promise<T>
): Promise<T> {
  return db.transaction(async (tx) => {
    await setCapitalSource(tx, source, userId, motivo);
    return fn(tx as unknown as DbOrTx);
  });
}

/**
 * Setea las GUCs del historial de capital sobre una transacción YA existente
 * (para write sites que corren dentro de su propio db.transaction). Debe
 * llamarse ANTES del UPDATE a creditos, dentro de la misma tx, para que el
 * trigger lea la fuente/usuario/motivo. Usa set_config con params ligados.
 * withCapitalContext delega aquí para no duplicar la lógica.
 */
// Ejecutor mínimo que cubre tanto `db` como una transacción `tx` (PgTransaction).
type SqlExecutor = { execute: (query: any) => Promise<unknown> };

export async function setCapitalSource(
  tx: SqlExecutor,
  source: string,
  userId?: number | null,
  motivo?: string | null
): Promise<void> {
  // Solo seteamos el usuario si es un entero finito: el trigger castea
  // app.current_user_id::INT, y un valor como 'NaN' abortaría el UPDATE del
  // crédito (rollback). Un id no numérico simplemente deja la atribución en NULL.
  if (userId != null && Number.isInteger(Number(userId))) {
    await tx.execute(
      sql`select set_config('app.current_user_id', ${String(Number(userId))}, true)`
    );
  }
  await tx.execute(sql`select set_config('app.capital_source', ${source}, true)`);
  if (motivo != null && motivo !== "") {
    await tx.execute(sql`select set_config('app.capital_motivo', ${motivo}, true)`);
  }
}
