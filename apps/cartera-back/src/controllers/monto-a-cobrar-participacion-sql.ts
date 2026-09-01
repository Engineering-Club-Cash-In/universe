export const participacionExternaActualCteSql = `
    participacion_externa_actual_base AS (
      SELECT
        ci.credito_id,
        SUM(ci.monto_aportado::numeric) AS total_aportado,
        BOOL_OR(ci.monto_aportado::numeric < 0) AS monto_aportado_negativo,
        CASE WHEN SUM(ci.monto_aportado::numeric) > 0 THEN
          COALESCE(SUM(ci.monto_aportado::numeric) FILTER (WHERE i.permite_distribucion = false), 0)
            / SUM(ci.monto_aportado::numeric)
          ELSE 0 END AS factor_capital_inversionista,
        CASE WHEN SUM(ci.monto_aportado::numeric) > 0 THEN
          COALESCE(SUM(
            ci.monto_aportado::numeric * COALESCE(
              mfs.spread::numeric / 100,
              ci.porcentaje_participacion_inversionista::numeric / 100
            )
          ) FILTER (WHERE i.permite_distribucion = false), 0)
            / SUM(ci.monto_aportado::numeric)
          ELSE 0 END AS factor_interes_iva_inversionista
      FROM cartera.creditos_inversionistas ci
      INNER JOIN cartera.inversionistas i ON i.inversionista_id = ci.inversionista_id
      LEFT JOIN cartera.creditos_inversionistas_espejo ces
        ON ces.credito_id = ci.credito_id
        AND ces.inversionista_id = ci.inversionista_id
      LEFT JOIN cartera.modalidad_facturacion_spread mfs
        ON mfs.id = ces.modalidad_facturacion_spread_id
      GROUP BY ci.credito_id
    ),
    participacion_interes_externa AS (
      SELECT
        ci.credito_id,
        ci.inversionista_id,
        CASE WHEN base.total_aportado > 0 THEN
          ci.monto_aportado::numeric
            * COALESCE(
              mfs.spread::numeric / 100,
              ci.porcentaje_participacion_inversionista::numeric / 100
            )
          ELSE 0 END AS interes_factor_numerador,
        base.total_aportado
      FROM cartera.creditos_inversionistas ci
      INNER JOIN cartera.inversionistas i ON i.inversionista_id = ci.inversionista_id
      INNER JOIN participacion_externa_actual_base base ON base.credito_id = ci.credito_id
      LEFT JOIN cartera.creditos_inversionistas_espejo ces
        ON ces.credito_id = ci.credito_id
        AND ces.inversionista_id = ci.inversionista_id
      LEFT JOIN cartera.modalidad_facturacion_spread mfs
        ON mfs.id = ces.modalidad_facturacion_spread_id
      WHERE i.permite_distribucion = false
    ),
    participacion_externa_actual AS (
      SELECT
        credito_id,
        factor_capital_inversionista,
        factor_interes_iva_inversionista,
        total_aportado <= 0
          OR monto_aportado_negativo
          OR factor_capital_inversionista NOT BETWEEN 0 AND 1
          OR factor_interes_iva_inversionista NOT BETWEEN 0 AND 1
          AS participacion_invalida
      FROM participacion_externa_actual_base
    )`;

export function buildInteresIvaInversionistaSql(
	interes: string,
	iva: string,
	creditoId: string,
): string {
	return `COALESCE((SELECT SUM(CASE WHEN pie.total_aportado > 0 THEN ROUND(${interes} * pie.interes_factor_numerador / pie.total_aportado, 2) + ROUND(${iva} * pie.interes_factor_numerador / pie.total_aportado, 2) ELSE 0 END) FROM participacion_interes_externa pie WHERE pie.credito_id = ${creditoId}), 0)`;
}
