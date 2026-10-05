import { sql } from "drizzle-orm";
import { SQL_CARTERA_SCHEMA } from "../database/db/schema";

// COBROS-02 Fase 4: EN_RECUPERACION devenga mora (decisión 2 del plan 08) y
// sigue en la cartera del asesor de B4, así que cuenta en estos reportes.
export const creditosElegiblesMoraSql = sql.raw("'ACTIVO', 'MOROSO', 'EN_RECUPERACION'");

export function buildCapitalCarteraQuery(
  emailCobrador?: string,
  asesores?: number[],
) {
  const emailFilter = emailCobrador
    ? sql`AND LOWER(a.email_cash_in) = LOWER(TRIM(${emailCobrador}))`
    : sql``;
  const asesoresFilter = asesores?.length
    ? sql`AND a.asesor_id IN (${sql.join(asesores.map((id) => sql`${id}`), sql`, `)})`
    : sql``;

  return sql`
    WITH cartera_filtrada AS (
      SELECT DISTINCT c.credito_id, c.capital::numeric AS capital,
        a.asesor_id, a.nombre, a.email_cash_in AS email_asesor
      FROM ${SQL_CARTERA_SCHEMA}.creditos c
      INNER JOIN ${SQL_CARTERA_SCHEMA}.asesores a ON a.asesor_id = c.asesor_id
      WHERE c."statusCredit" IN (${creditosElegiblesMoraSql})
        ${emailFilter}
        ${asesoresFilter}
    )
    SELECT asesor_id, nombre, email_asesor,
      COALESCE(SUM(capital), 0) AS capital
    FROM cartera_filtrada
    GROUP BY asesor_id, nombre, email_asesor
  `;
}
