import { describe, expect, it, mock } from "bun:test";
mock.module("../database", () => ({ db: {} }));
const { getCobranzaDiaria } = await import("./cobranzaDiariaReporte");

// Cola: 1ª execute = query A (créditos), 2ª = query B (inversionistas)
const makeExec = (responses: Array<{ rows: any[] }>) => {
	let i = 0;
	return { execute: (_q?: unknown) => Promise.resolve(responses[i++] ?? { rows: [] }) };
};

describe("getCobranzaDiaria", () => {
	it("arma asesores + totalGeneral con CUBE residuo por crédito", async () => {
		const exec = makeExec([
			{ rows: [ // query A: 1 crédito, asesor 10
				{ credito_id: 1, numero_credito_sifco: "X1", cliente_nombre: "Cli", asesor_id: 10, asesor_nombre: "Sam",
				  cap_rest: "100", int_rest: "683.82", iva_rest: "82.06", seg_rest: "0", gps_rest: "0", mem_rest: "0",
				  cap_cob: "0", int_cob: "0", iva_cob: "0", seg_cob: "0", gps_cob: "0", mem_cob: "0", mora_cob: "0" },
			] },
			{ rows: [ // query B: Brenda 70/30 + CUBE
				{ credito_id: 1, inversionista_id: 1, nombre: "Brenda", porcentaje_participacion_inversionista: "70", porcentaje_cash_in: "30", monto_aportado: "25324.90" },
				{ credito_id: 1, inversionista_id: 86, nombre: "Cube Investments S.A.", porcentaje_participacion_inversionista: "0", porcentaje_cash_in: "100", monto_aportado: "20108.92" },
			] },
		]);
		const { asesores, totalGeneral } = await getCobranzaDiaria({ anio: 2026, mes: 7, dia: 8, executor: exec as any });
		expect(asesores).toHaveLength(1);
		expect(asesores[0].asesor_nombre).toBe("Sam");
		expect(asesores[0].cuotas).toBe(1);
		// esperado interés 683.82 → CUBE esperado ≈ 417.02
		expect(Number(asesores[0].cube.esperado)).toBeCloseTo(417.02, 0);
		// nada cobrado → efectividad 0, restante = total esperado
		expect(asesores[0].total_cobrado).toBe("0.00");
		expect(asesores[0].efectividad).toBe(0);
		expect(totalGeneral.asesor_nombre).toBe("TOTAL");
	});
});

const { getCobranzaDiariaDetalle } = await import("./cobranzaDiariaReporte");

describe("getCobranzaDiariaDetalle", () => {
	it("pagina y reporta hasMore usando el count", async () => {
		const exec = makeExec([
			{ rows: [ { credito_id: 1, numero_credito_sifco: "X1", cliente_nombre: "Cli", asesor_id: 10, asesor_nombre: "Sam",
				cap_rest: "100", int_rest: "0", iva_rest: "0", seg_rest: "0", gps_rest: "0", mem_rest: "0",
				cap_cob: "0", int_cob: "0", iva_cob: "0", seg_cob: "0", gps_cob: "0", mem_cob: "0", mora_cob: "0" } ] }, // qA
			{ rows: [] }, // qB inversionistas
			{ rows: [{ total: "23" }] }, // count
		]);
		const res = await getCobranzaDiariaDetalle({ anio: 2026, mes: 7, dia: 8, asesorId: 10, limit: 10, offset: 0, executor: exec as any });
		expect(res.creditos).toHaveLength(1);
		expect(res.total).toBe(23);
		expect(res.hasMore).toBe(true);
	});
});
