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
