/**
 * CB-119 — sifcosEnB4 y unidadesConCasoActivo: el universo que consulta el
 * job es "créditos en B4 según cartera-back", no "todo caso activo". Test
 * separado de gps-eventos-poll.test.ts (que prueba detectarTransiciones sin
 * mocks) porque acá sí hace falta mockear DB y cartera-back-client.
 */
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import { contratosFinanciamiento } from "../db/schema/cobros";
import { vehicles } from "../db/schema/vehicles";
import { carteraBackClient } from "../services/cartera-back-client";
import * as carteraBackIntegration from "../services/cartera-back-integration";

let porContratoMock: {
	wialonUnitId: number | null;
	numeroCreditoSifco: string | null;
}[] = [];
let porOportunidadMock: {
	wialonUnitId: number | null;
	numeroCreditoSifco: string | null;
}[] = [];

function mockDb() {
	return {
		selectDistinct: () => ({
			from: (tabla: unknown) => {
				if (tabla === vehicles) {
					return {
						innerJoin: (segunda: unknown) => ({
							innerJoin: () => ({
								where: async () =>
									segunda === contratosFinanciamiento
										? porContratoMock
										: porOportunidadMock,
							}),
						}),
					};
				}
				throw new Error(
					`selectDistinct from tabla no mockeada: ${String(tabla)}`,
				);
			},
		}),
	};
}

// mock.module solo para `db` (nadie más de la suite de tests toca este path
// con expectativas incompatibles). `carteraBackClient` y
// `isCarteraBackEnabled` se espían con spyOn sobre los módulos REALES: un
// mock.module de cartera-back-client rompía otros tests de la misma suite
// (routers/cobros.ts importa `CarteraBackHttpError` del mismo módulo, y el
// mock global lo dejaba sin esa export cuando los archivos corren juntos).
mock.module("../db", () => ({ db: mockDb() }));

const { sifcosEnB4, unidadesConCasoActivo } = await import(
	"./gps-eventos-poll"
);

// El mock devuelve solo el campo (creditos.numero_credito_sifco) que
// sifcosEnB4 realmente lee; tipar contra CreditoDetailResponse completo
// (decenas de campos) es ruido puro acá.
// biome-ignore lint/suspicious/noExplicitAny: ver comentario arriba.
let getAllCreditosSpy: any;
let isCarteraBackEnabledSpy: ReturnType<typeof spyOn>;

function respuestaPagina(sifcos: string[]) {
	return {
		data: sifcos.map((s) => ({ creditos: { numero_credito_sifco: s } })),
		total: sifcos.length,
		page: 1,
		perPage: 1000,
		totalPages: 1,
	};
}

beforeEach(() => {
	porContratoMock = [];
	porOportunidadMock = [];
	isCarteraBackEnabledSpy = spyOn(
		carteraBackIntegration,
		"isCarteraBackEnabled",
	).mockReturnValue(true);
	getAllCreditosSpy = spyOn(carteraBackClient, "getAllCreditos");
	getAllCreditosSpy.mockImplementation(async () => respuestaPagina([]));
});

afterEach(() => {
	mock.restore();
});

describe("CB-119 — sifcosEnB4", () => {
	test("cartera-back deshabilitado: devuelve null (no [])", async () => {
		isCarteraBackEnabledSpy.mockReturnValue(false);
		const resultado = await sifcosEnB4();
		expect(resultado).toBeNull();
		expect(getAllCreditosSpy).not.toHaveBeenCalled();
	});

	test("getAllCreditos lanza: devuelve null, no [] (para no confundir fallo con 'sin B4 hoy')", async () => {
		getAllCreditosSpy.mockImplementation(async () => {
			throw new Error("cartera-back caído");
		});
		const resultado = await sifcosEnB4();
		expect(resultado).toBeNull();
	});

	test("consulta MOROSO y EN_RECUPERACION con cuotas_min y cuotas_max en 4, y sin filtro de fecha de creación", async () => {
		await sifcosEnB4();
		const estados = getAllCreditosSpy.mock.calls.map(
			(c: unknown[]) => (c[0] as { estado: string }).estado,
		);
		expect(estados.sort()).toEqual(["EN_RECUPERACION", "MOROSO"]);
		for (const call of getAllCreditosSpy.mock.calls) {
			const params = call[0] as {
				cuotas_min: number;
				cuotas_max: number;
				mes: number;
				anio: number;
			};
			expect(params.cuotas_min).toBe(4);
			expect(params.cuotas_max).toBe(4);
			// mes/anio en 0 = sin filtro por fecha de creación del crédito
			// (cartera-back lo trata como "créditos creados ese mes", no como
			// "mes de reporte actual" — un crédito viejo en B4 quedaría afuera).
			expect(params.mes).toBe(0);
			expect(params.anio).toBe(0);
		}
	});

	test("junta y deduplica SIFCOs de ambos estados", async () => {
		getAllCreditosSpy.mockImplementation(async (params: unknown) => {
			const estado = (params as { estado: string }).estado;
			return estado === "MOROSO"
				? respuestaPagina(["001", "002"])
				: respuestaPagina(["002", "003"]);
		});
		const resultado = await sifcosEnB4();
		expect(resultado?.sort()).toEqual(["001", "002", "003"]);
	});

	test("créditos sin numero_credito_sifco se ignoran", async () => {
		getAllCreditosSpy.mockImplementation(async () => ({
			data: [{ creditos: { numero_credito_sifco: "" } }, { creditos: {} }],
			total: 2,
			page: 1,
			perPage: 1000,
			totalPages: 1,
		}));
		const resultado = await sifcosEnB4();
		expect(resultado).toEqual([]);
	});
});

describe("CB-119 — unidadesConCasoActivo", () => {
	test("lista de SIFCOs B4 vacía: no consulta la DB, devuelve []", async () => {
		const resultado = await unidadesConCasoActivo([]);
		expect(resultado).toEqual([]);
	});

	test("junta unidades de ambos caminos (contrato y oportunidad) sin duplicar", async () => {
		porContratoMock = [
			{ wialonUnitId: 100, numeroCreditoSifco: "001" },
			{ wialonUnitId: 200, numeroCreditoSifco: "002" },
		];
		porOportunidadMock = [
			{ wialonUnitId: 200, numeroCreditoSifco: "002" },
			{ wialonUnitId: 300, numeroCreditoSifco: "003" },
		];

		const resultado = await unidadesConCasoActivo(["001", "002", "003"]);
		const ids = resultado.map((u) => u.wialonUnitId).sort((a, b) => a - b);
		expect(ids).toEqual([100, 200, 300]);
	});

	test("filas con wialonUnitId null se descartan", async () => {
		porContratoMock = [
			{ wialonUnitId: null, numeroCreditoSifco: "001" },
			{ wialonUnitId: 100, numeroCreditoSifco: "001" },
		];

		const resultado = await unidadesConCasoActivo(["001"]);
		expect(resultado).toEqual([
			{ wialonUnitId: 100, numeroCreditoSifco: "001" },
		]);
	});

	test("propaga el numeroCreditoSifco de cada unidad para acotar la resolución del caso", async () => {
		porContratoMock = [{ wialonUnitId: 100, numeroCreditoSifco: "001" }];

		const resultado = await unidadesConCasoActivo(["001"]);
		expect(resultado).toEqual([
			{ wialonUnitId: 100, numeroCreditoSifco: "001" },
		]);
	});

	test("una misma unidad Wialon con DOS SIFCOs B4 distintos (dos vehículos compartiendo GPS): devuelve las DOS filas, no colapsa a una", async () => {
		// Antes de este fix se colapsaba a una fila por unidad (se quedaba con
		// la primera vista) y el segundo caso nunca se consultaba ni
		// notificaba a su asesor.
		porContratoMock = [
			{ wialonUnitId: 100, numeroCreditoSifco: "001" },
			{ wialonUnitId: 100, numeroCreditoSifco: "002" },
		];

		const resultado = await unidadesConCasoActivo(["001", "002"]);
		const claves = resultado
			.map((u) => `${u.wialonUnitId}:${u.numeroCreditoSifco}`)
			.sort();
		expect(claves).toEqual(["100:001", "100:002"]);
	});
});

describe("CB-119 — correrDeteccionEventosGps: guard de ejecución solapada", () => {
	test("una corrida en curso bloquea un segundo tick concurrente", async () => {
		const { correrDeteccionEventosGps } = await import("./gps-eventos-poll");

		// isCarteraBackEnabled se resuelve dentro de sifcosEnB4, que corre
		// DESPUÉS de que el guard ya marcó corridaEnCurso = true (síncrono, al
		// entrar a la función) — sirve para contar cuántas veces el cuerpo de
		// la corrida realmente llegó a ejecutarse.
		let llamadas = 0;
		isCarteraBackEnabledSpy.mockImplementation(() => {
			llamadas++;
			return false; // corta rápido en sifcosEnB4 → null, sin más I/O que mockear
		});

		// Dos ticks "simultáneos": el segundo arranca antes de que el primero
		// termine (mismo patrón que setInterval disparando dos veces si una
		// corrida se demora más que el intervalo).
		await Promise.all([
			correrDeteccionEventosGps(),
			correrDeteccionEventosGps(),
		]);

		expect(llamadas).toBe(1);
	});

	test("corridas NO solapadas (una termina antes de que arranque la otra): ambas ejecutan", async () => {
		const { correrDeteccionEventosGps } = await import("./gps-eventos-poll");

		let llamadas = 0;
		isCarteraBackEnabledSpy.mockImplementation(() => {
			llamadas++;
			return false;
		});

		await correrDeteccionEventosGps();
		await correrDeteccionEventosGps();

		expect(llamadas).toBe(2);
	});
});
