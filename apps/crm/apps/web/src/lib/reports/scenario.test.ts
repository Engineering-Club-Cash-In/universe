import { describe, expect, test } from "bun:test";
import {
	type ComparativoHistoricoRow,
	cuotaIlustrativa,
	DEFAULT_SCENARIO_PARAMS,
	type FacturacionMesResponse,
	type FlujoCuotasInversionesResponse,
	type MontoACobrarRow,
	type PuntoEquilibrioRow,
	type ScenarioParams,
	transformCobertura,
	transformComparativo,
	transformFacturacion,
	transformMontoACobrar,
} from "./scenario";
import { flujoCuotasConfig, montoACobrarConfig } from "./scenario-configs";

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

	test("efectividad negativa no cancela reducción de mora válida", () => {
		// mora=100 debería cerrar el 100% de la brecha aunque efectividad=-100
		const out = transformFacturacion(
			data,
			params({ moraReduccionPct: 100, efectividadDeltaPct: -100 }),
		);
		// capital: cobrado=800, esperado=1000, brecha=200, close=clamp01(0+1)=1 → 1000
		expect(out.cobrado.capital).toBe("1000.00");
	});

	test("rubro sobre-cobrado (cobrado > esperado) se preserva intacto", () => {
		const over: FacturacionMesResponse = {
			cobrado: { ...data.cobrado, interes: "150" },
			esperado: { ...data.esperado, interes: "100" },
		};
		const out = transformFacturacion(
			over,
			params({ efectividadDeltaPct: 100 }),
		);
		expect(out.cobrado.interes).toBe("150.00");
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

	test("efectividad negativa se acota a 0 (facturación no baja)", () => {
		const out = transformComparativo(
			rows,
			params({ efectividadDeltaPct: -150 }),
		);
		expect(out[0].facturacion).toBe("50000.00");
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

describe("montoACobrarConfig.summarize", () => {
	test("mora se promedia entre buckets, no se suma", () => {
		const rows: MontoACobrarRow[] = [
			montoRow({ mora_promedio: "100" }),
			montoRow({ mora_promedio: "100" }),
		];
		const summary = montoACobrarConfig.summarize(rows);
		const mora = summary.find((s) => s.concepto === "Mora prom.");
		expect(mora?.valor).toBe(100);
	});
});

describe("flujoCuotasConfig.summarize", () => {
	const data: FlujoCuotasInversionesResponse = {
		reinversionPorTipo: [
			{
				tipo: "reinversion_variable",
				capital: "0",
				interes: "0",
				iva: "0",
				monto_reinvertido: "5000",
			},
			{ tipo: "reinversion_interes", capital: "0", interes: "200", iva: "24" },
		],
		cashParcialPorTipo: [
			{ tipo: "cash", capital: "0", interes: "0", iva: "0", monto_cash: "300" },
		],
		sinReinversion: {
			totales: { capital: "100", interes: "50", iva: "6" },
			porInversionista: [],
		},
		pagosExtras: { abonos_capital: "0", cancelaciones: "0" },
	};

	test("reinversión variable usa monto_reinvertido e interés incluye IVA", () => {
		const summary = flujoCuotasConfig.summarize(data);
		const reinv = summary.find((s) => s.concepto === "Reinversión");
		// 5000 (variable total-only) + 200 + 24 (interés + IVA)
		expect(reinv?.valor).toBe(5224);
	});

	test("cash usa monto_cash y sin-reinversión incluye IVA", () => {
		const summary = flujoCuotasConfig.summarize(data);
		expect(summary.find((s) => s.concepto === "Cash parcial")?.valor).toBe(300);
		// 100 + 50 + 6
		expect(summary.find((s) => s.concepto === "Sin reinversión")?.valor).toBe(
			156,
		);
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
