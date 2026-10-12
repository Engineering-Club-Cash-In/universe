import { describe, expect, test } from "bun:test";
import {
	type CuotaProximaParaPrejuridico,
	listosPrejuridico,
	sifcosProximosAB4,
} from "./prejuridico";

function cuota(
	sifco: string,
	over: Partial<CuotaProximaParaPrejuridico> = {},
): CuotaProximaParaPrejuridico {
	return {
		numero_credito_sifco: sifco,
		status_credit: "MOROSO",
		bucket: 3,
		cuotas_vencidas_reales: 3,
		dias_para_vencer: 4,
		...over,
	};
}

describe("prejuridico", () => {
	test("B3 con 3 vencidas y la 4.ª dentro de la ventana califica", () => {
		expect([...sifcosProximosAB4([cuota("A")])]).toEqual(["A"]);
	});

	test("deja fuera otros buckets, estados y vencidas", () => {
		const resultado = sifcosProximosAB4([
			cuota("B2", { bucket: 2 }),
			cuota("B4", { bucket: 4 }),
			cuota("CONV", { status_credit: "EN_CONVENIO" }),
			cuota("JUR", { status_credit: "EN_JURIDICO" }),
			cuota("DOS", { cuotas_vencidas_reales: 2 }),
			cuota("NULL", { bucket: null }),
		]);
		expect(resultado.size).toBe(0);
	});

	test("la ventana es de 7 días inclusive", () => {
		expect(sifcosProximosAB4([cuota("A", { dias_para_vencer: 7 })]).size).toBe(
			1,
		);
		expect(sifcosProximosAB4([cuota("A", { dias_para_vencer: 8 })]).size).toBe(
			0,
		);
		expect(sifcosProximosAB4([cuota("A", { dias_para_vencer: 0 })]).size).toBe(
			1,
		);
	});

	test("no cuenta dos veces un crédito con dos filas", () => {
		const r = sifcosProximosAB4([
			cuota("A", { dias_para_vencer: 2 }),
			cuota("A", { dias_para_vencer: 6 }),
		]);
		expect(r.size).toBe(1);
	});

	test("quita los que tienen promesa vigente", () => {
		expect(listosPrejuridico(new Set(["A", "B"]), new Set(["B"]))).toEqual([
			"A",
		]);
	});
});
