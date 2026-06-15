import { describe, expect, test } from "bun:test";
import {
	type ComparativoHistoricoRow,
	cuotaIlustrativa,
	DEFAULT_SCENARIO_PARAMS,
	type FacturacionMesResponse,
	type MontoACobrarRow,
	type PuntoEquilibrioRow,
	type ScenarioParams,
	transformCobertura,
	transformComparativo,
	transformFacturacion,
	transformMontoACobrar,
} from "./scenario";

const params = (overrides: Partial<ScenarioParams> = {}): ScenarioParams => ({
	...DEFAULT_SCENARIO_PARAMS,
	...overrides,
});

const montoRow = (over: Partial<MontoACobrarRow> = {}): MontoACobrarRow => ({
	bucket: "2026-01-01",
	cuotas_count: 10,
	total_cuota: "1000",
	total_interes: "200",
	total_iva: "24",
	total_seguro: "50",
	total_gps: "30",
	total_membresias: "40",
	total_royalti: "10",
	mora_promedio: "100",
	...over,
});

describe("transformMontoACobrar", () => {
	test("método actual sin cambios = identidad", () => {
		const rows = [montoRow()];
		const out = transformMontoACobrar(rows, params());
		expect(out[0].total_cuota).toBe("1000.00");
		expect(out[0].mora_promedio).toBe("100.00");
		expect(out[0].cuotas_count).toBe(10);
	});

	test("bajar mora 10% reduce mora_promedio 10%", () => {
		const out = transformMontoACobrar(
			[montoRow()],
			params({ moraReduccionPct: 10 }),
		);
		expect(out[0].mora_promedio).toBe("90.00");
	});

	test("bajar mora >100% se acota a 0 (sin mora negativa)", () => {
		const out = transformMontoACobrar(
			[montoRow()],
			params({ moraReduccionPct: 120 }),
		);
		expect(out[0].mora_promedio).toBe("0.00");
	});

	test("colocar +20% escala los rubros", () => {
		const out = transformMontoACobrar(
			[montoRow()],
			params({ colocacionDeltaPct: 20 }),
		);
		expect(out[0].total_cuota).toBe("1200.00");
		expect(out[0].cuotas_count).toBe(12);
	});
});

describe("transformFacturacion", () => {
	const data: FacturacionMesResponse = {
		cobrado: {
			capital: "800",
			interes: "100",
			iva: "12",
			seguro: "0",
			gps: "0",
			membresias: "0",
		},
		esperado: {
			capital: "1000",
			interes: "100",
			iva: "12",
			seguro: "0",
			gps: "0",
			membresias: "0",
		},
	};

	test("efectividad +100% iguala cobrado a esperado", () => {
		const out = transformFacturacion(
			data,
			params({ efectividadDeltaPct: 100 }),
		);
		expect(out.cobrado.capital).toBe("1000.00");
	});

	test("efectividad +50% cierra la mitad de la brecha", () => {
		const out = transformFacturacion(data, params({ efectividadDeltaPct: 50 }));
		expect(out.cobrado.capital).toBe("900.00");
	});

	test("esperado no cambia", () => {
		const out = transformFacturacion(
			data,
			params({ efectividadDeltaPct: 100 }),
		);
		expect(out.esperado.capital).toBe("1000");
	});
});

describe("transformCobertura", () => {
	const rows: PuntoEquilibrioRow[] = [
		{
			bucket: "2026-01-01",
			cantidad_creditos: 5,
			colocado: "50000",
			meta: "100000",
			cobertura: "50.0",
			faltante: "50000.00",
		},
	];

	test("colocar +100% duplica colocado y recalcula cobertura/faltante", () => {
		const out = transformCobertura(rows, params({ colocacionDeltaPct: 100 }));
		expect(out[0].colocado).toBe("100000.00");
		expect(out[0].cobertura).toBe("100.0");
		expect(out[0].faltante).toBe("0.00");
	});
});

describe("transformComparativo", () => {
	const rows: ComparativoHistoricoRow[] = [
		{
			mes: 1,
			colocacion_monto: "100000",
			colocacion_creditos: 10,
			facturacion: "50000",
			cartera_activa: "200000",
			creditos_activos: 30,
			mora_30: "1000",
			mora_60: "500",
			mora_90: "200",
			mora_120: "100",
			creditos_30: 4,
			creditos_60: 2,
			creditos_90: 1,
			creditos_120: 1,
		},
	];

	test("bajar mora 50% reduce buckets de mora a la mitad", () => {
		const out = transformComparativo(rows, params({ moraReduccionPct: 50 }));
		expect(out[0].mora_30).toBe("500.00");
		expect(out[0].mora_120).toBe("50.00");
	});

	test("colocar +10% escala colocación; nulos siguen nulos", () => {
		const withNull = [{ ...rows[0], colocacion_monto: null }];
		const out = transformComparativo(
			withNull,
			params({ colocacionDeltaPct: 10 }),
		);
		expect(out[0].colocacion_monto).toBeNull();
		expect(out[0].cartera_activa).toBe("220000.00");
	});
});

describe("cuotaIlustrativa", () => {
	test("francés y fija son positivas y la fija (1ª) es mayor", () => {
		const { frances, fija } = cuotaIlustrativa(
			params({
				metodoCapital: 50000,
				metodoPlazoMeses: 12,
				metodoTasaMensual: 1.78,
			}),
		);
		expect(frances).toBeGreaterThan(0);
		expect(fija).toBeGreaterThan(0);
		expect(fija).toBeGreaterThan(frances);
	});
});
