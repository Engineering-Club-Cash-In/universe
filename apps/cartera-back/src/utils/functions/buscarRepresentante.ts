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
): Promise<{
  /**
   * Tal como está en la base, sin rellenos. Antes se devolvía "Inversionista"
   * cuando venía vacío, y ese genérico tapaba el caso en vez de resolverlo: el
   * correo terminaba desviado al buzón del representante saludando a nadie.
   * Quien decide qué hacer sin nombre es `destinatarioDeLiquidacion`.
   */
  nombre: string | null;
  email: string | null;
  dpi: number | string | null;
} | null> => {
  const filas = await db
    .select({
      nombre: inversionistas.nombre,
      email: inversionistas.email,
      // Va de vuelta para que el llamador pueda reconocer al que se representa
      // a sí mismo (id 187) comparándolo con el `dpi` de la entidad liquidada.
      dpi: inversionistas.dpi,
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
    nombre: fila.nombre?.trim() ? fila.nombre.trim() : null,
    email: fila.email?.trim() ? fila.email.trim().toLowerCase() : null,
    dpi: fila.dpi ?? null,
  };
};
