import { asc } from "drizzle-orm";
import { db } from "../database";
import { aseguradoras } from "../database/db/schema";

type DbExecutor = Pick<typeof db, "select">;

/**
 * Devuelve el catálogo de aseguradoras ordenado por nombre.
 *
 * Acepta un executor opcional para facilitar el unit-testing (mock de `../database`).
 */
export async function listAseguradoras(executor: DbExecutor = db): Promise<{
  data: { id: number; nombre: string }[];
}> {
  const rows = await executor
    .select({ id: aseguradoras.id, nombre: aseguradoras.nombre })
    .from(aseguradoras)
    .orderBy(asc(aseguradoras.nombre));

  return { data: rows };
}
