import { describe, expect, test } from "bun:test";
import {
	BANK_ANALYSIS_PROMPT,
	bankStatementAnalysisSchema,
} from "./bank-analysis-schema";

function analysisFixture(overrides: Record<string, unknown> = {}) {
	return {
		datos_generales: {
			nombre_cuentahabiente: "Persona de prueba",
			numero_cuenta: "TEST-001",
			tipo_cuenta: "Monetaria",
		},
		resumen_mensual: [
			{
				mes: "Junio 2026",
				saldo_inicial: 100,
				total_debitos: 40,
				total_creditos: 60,
				saldo_final: 120,
				ingresos: { fijos: 60, variables: 0 },
				gastos: { fijos: 40, variables: 0 },
			},
		],
		promedio_mensual: {
			promedio_ingresos_fijos: 60,
			promedio_ingresos_variables: 0,
			promedio_gastos_fijos: 40,
			promedio_gastos_variables: 0,
			disponibilidad_economica: 20,
		},
		analisis_fecha_pago: null,
		estados_cuenta_detectados: 1,
		moneda: "GTQ",
		...overrides,
	};
}

describe("bank analysis AI contract", () => {
	test("accepts indexed canonical monthly provenance from the existing analysis call", () => {
		const parsed = bankStatementAnalysisSchema.parse(
			analysisFixture({
				cobertura_por_archivo: [
					{
						indice_archivo: 0,
						meses: ["2026-06", "2026-07", "2026-08"],
					},
				],
			}),
		);

		expect(parsed.cobertura_por_archivo).toEqual([
			{
				indice_archivo: 0,
				meses: ["2026-06", "2026-07", "2026-08"],
			},
		]);
	});

	test("keeps historical payloads valid when coverage is absent", () => {
		const parsed = bankStatementAnalysisSchema.parse(analysisFixture());
		expect(parsed.cobertura_por_archivo).toBeUndefined();
	});

	test("keeps ambiguous month strings available for fail-closed server resolution", () => {
		for (const value of ["Junio 2026", "Junio", "ilegible", "2026-13"]) {
			const parsed = bankStatementAnalysisSchema.parse(
				analysisFixture({
					cobertura_por_archivo: [{ indice_archivo: 0, meses: [value] }],
				}),
			);
			expect(parsed.cobertura_por_archivo?.[0].meses).toEqual([value]);
		}
	});

	test("does not use Spanish financial summary labels as provenance", () => {
		for (const label of [
			"Enero 2026",
			"Enero 2026",
			"Enero",
			"Periodo ilegible",
		]) {
			const parsed = bankStatementAnalysisSchema.parse(
				analysisFixture({
					resumen_mensual: [
						{ ...analysisFixture().resumen_mensual[0], mes: label },
					],
				}),
			);
			expect(parsed.resumen_mensual[0].mes).toBe(label);
			expect(parsed.cobertura_por_archivo).toBeUndefined();
		}
	});

	test("prompt requests canonical months with stable file indices in the same call", () => {
		expect(BANK_ANALYSIS_PROMPT).toContain("cobertura_por_archivo");
		expect(BANK_ANALYSIS_PROMPT).toContain("YYYY-MM");
		expect(BANK_ANALYSIS_PROMPT).toContain("indice_archivo");
		expect(BANK_ANALYSIS_PROMPT).toContain("misma llamada");
	});
});
