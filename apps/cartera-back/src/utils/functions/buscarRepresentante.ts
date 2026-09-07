import { sql } from "drizzle-orm";
import { db } from "../../database/index";
import { inversionistas } from "../../database/db/schema";

/**
 * Encuentra al representante legal como fila de cartera, a partir del
 * `dpi_rep_legal` que trae la empresa.
 *
 * Compara sin ceros a la izquierda porque `dpi` es bigint (nunca los trae) y
 * `dpi_rep_legal` es varchar (sí los conserva): '04036613' tiene que encontrar
 * al dpi 4036613. Verificado contra el dump: los 10 representantes de las
 * empresas de hoy son alcanzables así.
 */
export const buscarRepresentanteEnCartera = async (
  dpiNormalizado: string,
): Promise<{ nombre: string; email: string | null } | null> => {
  const filas = await db
    .select({
      nombre: inversionistas.nombre,
      email: inversionistas.email,
    })
    .from(inversionistas)
    .where(
      sql`ltrim(coalesce(${inversionistas.dpi}::text, ''), '0') = ${dpiNormalizado}`,
    )
    // Determinista: si hubiera dos filas con el mismo DPI, gana siempre la
    // misma (la más antigua), no la que devuelva el planificador ese día.
    .orderBy(sql`${inversionistas.inversionista_id} ASC`)
    .limit(1);

  const fila = filas[0];
  if (!fila) return null;

  return {
    nombre: fila.nombre ?? "Inversionista",
    email: fila.email?.trim() ? fila.email.trim().toLowerCase() : null,
  };
};
