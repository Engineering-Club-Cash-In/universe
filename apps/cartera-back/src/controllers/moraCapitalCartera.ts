import { sql } from "drizzle-orm";

export const creditosVigentesSql = sql.raw(
  "'ACTIVO', 'MOROSO', 'PENDIENTE_CANCELACION', 'EN_CONVENIO', 'INCOBRABLE'",
);

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
      FROM cartera.creditos c
      INNER JOIN cartera.asesores a ON a.asesor_id = c.asesor_id
      WHERE c."statusCredit" IN (${creditosVigentesSql})
        ${emailFilter}
        ${asesoresFilter}
    )
    SELECT asesor_id, nombre, email_asesor,
      COALESCE(SUM(capital), 0) AS capital
    FROM cartera_filtrada
    GROUP BY asesor_id, nombre, email_asesor
  `;
}
