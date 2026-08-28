import { expect, test } from "bun:test";
import {
	buildInteresIvaInversionistaSql,
	participacionExternaActualCteSql,
} from "./monto-a-cobrar-participacion-sql";

test("la CTE inyectada usa factores de monto y spread histórico sin excluir créditos", async () => {
	const source = await Bun.file(new URL("./reportes.ts", import.meta.url)).text();

	expect(source).toContain('from "./monto-a-cobrar-participacion-sql"');
	expect(source).toContain("${sql.raw(participacionExternaActualCteSql)}");
	expect(participacionExternaActualCteSql).toContain("AS factor_capital_inversionista");
	expect(participacionExternaActualCteSql).toContain("AS factor_interes_iva_inversionista");
	expect(participacionExternaActualCteSql).toContain("ci.monto_aportado::numeric");
	expect(participacionExternaActualCteSql).toContain("mfs.spread::numeric / 100");
	expect(participacionExternaActualCteSql).toContain("COALESCE(");
	expect(participacionExternaActualCteSql).toContain("ci.porcentaje_participacion_inversionista::numeric / 100");
	expect(participacionExternaActualCteSql).not.toContain("FILTER (WHERE NOT participacion_invalida)");
	expect(participacionExternaActualCteSql).toContain("AS participacion_invalida");
	expect(source).toContain("COUNT(credito_id) FILTER (WHERE participacion_invalida)");
	expect(source).not.toContain("0::int AS creditos_participacion_invalida");
	expect(participacionExternaActualCteSql).toContain("participacion_interes_externa AS");
	expect(participacionExternaActualCteSql).toContain("CASE WHEN SUM(ci.monto_aportado::numeric) > 0 THEN");
	expect(participacionExternaActualCteSql).toContain("CASE WHEN base.total_aportado > 0");
	expect(source).toContain("buildInteresIvaInversionistaSql");
	expect(buildInteresIvaInversionistaSql("interes", "iva", "pbc.credito_id")).toContain(
		"CASE WHEN pie.total_aportado > 0 THEN ROUND(interes * pie.interes_factor_numerador / pie.total_aportado, 2)",
	);
	expect(buildInteresIvaInversionistaSql("interes", "iva", "pbc.credito_id")).toContain(
		"ROUND(iva * pie.interes_factor_numerador / pie.total_aportado, 2)",
	);
});
