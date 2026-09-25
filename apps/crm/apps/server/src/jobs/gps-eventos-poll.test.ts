/**
 * CB-119 — detectarTransiciones: la lógica pura del job de polling.
 * No toca DB ni Wialon, así que no hace falta mockear nada acá.
 */
import { describe, expect, test } from "bun:test";
import type { WialonTelemetriaUnidad } from "../services/wialon/wialon-types";
import { detectarTransiciones, esPoligonoValido } from "./gps-eventos-poll";

const ahora = new Date("2026-09-24T12:00:00.000Z");

function telemetria(
	over: Partial<WialonTelemetriaUnidad> = {},
): WialonTelemetriaUnidad {
	return {
		unitId: 1,
		ultimoMensajeAt: ahora,
		pwrExt: 12.9,
		ignicionOn: false,
		lat: 14.6,
		lon: -90.5,
		velocidadKmh: 0,
		...over,
	};
}

describe("CB-119 — detectarTransiciones: energía", () => {
	test("sin snapshot previo y pwrExt bajo: SÍ genera evento (primera vez que se ve la unidad)", () => {
		const eventos = detectarTransiciones(
			telemetria({ pwrExt: 1.2 }),
			null,
			ahora,
		);
		expect(eventos.some((e) => e.tipo === "desconexion_energia")).toBe(true);
	});

	test("ya estaba desconectada (anterior también bajo): NO repite el evento", () => {
		const eventos = detectarTransiciones(
			telemetria({ pwrExt: 1.0 }),
			{
				pwrExt: 0.8,
				ignicionOn: false,
				sinReportarDesde: null,
				dentroDeGeocerca: null,
			},
			ahora,
		);
		expect(eventos.some((e) => e.tipo === "desconexion_energia")).toBe(false);
	});

	test("transición de con-energía a sin-energía: SÍ genera evento", () => {
		const eventos = detectarTransiciones(
			telemetria({ pwrExt: 1.0 }),
			{
				pwrExt: 12.5,
				ignicionOn: false,
				sinReportarDesde: null,
				dentroDeGeocerca: null,
			},
			ahora,
		);
		expect(eventos.some((e) => e.tipo === "desconexion_energia")).toBe(true);
	});

	test("energía restaurada (anterior bajo, ahora normal): NO genera evento de desconexión", () => {
		const eventos = detectarTransiciones(
			telemetria({ pwrExt: 12.5 }),
			{
				pwrExt: 1.0,
				ignicionOn: false,
				sinReportarDesde: null,
				dentroDeGeocerca: null,
			},
			ahora,
		);
		expect(eventos.some((e) => e.tipo === "desconexion_energia")).toBe(false);
	});

	test("pwrExt null (Wialon no lo reportó): no genera evento de energía", () => {
		const eventos = detectarTransiciones(
			telemetria({ pwrExt: null }),
			{
				pwrExt: 12.5,
				ignicionOn: false,
				sinReportarDesde: null,
				dentroDeGeocerca: null,
			},
			ahora,
		);
		expect(eventos.some((e) => e.tipo === "desconexion_energia")).toBe(false);
	});
});

describe("CB-119 — detectarTransiciones: ignición", () => {
	test("transición apagado→encendido: SÍ genera evento", () => {
		const eventos = detectarTransiciones(
			telemetria({ ignicionOn: true }),
			{
				pwrExt: 12.9,
				ignicionOn: false,
				sinReportarDesde: null,
				dentroDeGeocerca: null,
			},
			ahora,
		);
		expect(eventos.some((e) => e.tipo === "ignicion")).toBe(true);
	});

	test("ya estaba encendida: NO repite el evento", () => {
		const eventos = detectarTransiciones(
			telemetria({ ignicionOn: true }),
			{
				pwrExt: 12.9,
				ignicionOn: true,
				sinReportarDesde: null,
				dentroDeGeocerca: null,
			},
			ahora,
		);
		expect(eventos.some((e) => e.tipo === "ignicion")).toBe(false);
	});

	test("se apaga: no genera evento de ignición (solo interesa el encendido)", () => {
		const eventos = detectarTransiciones(
			telemetria({ ignicionOn: false }),
			{
				pwrExt: 12.9,
				ignicionOn: true,
				sinReportarDesde: null,
				dentroDeGeocerca: null,
			},
			ahora,
		);
		expect(eventos.some((e) => e.tipo === "ignicion")).toBe(false);
	});

	test("ignicionOn null (sensor no resuelto): no genera evento", () => {
		const eventos = detectarTransiciones(
			telemetria({ ignicionOn: null }),
			{
				pwrExt: 12.9,
				ignicionOn: false,
				sinReportarDesde: null,
				dentroDeGeocerca: null,
			},
			ahora,
		);
		expect(eventos.some((e) => e.tipo === "ignicion")).toBe(false);
	});
});

describe("CB-119 — detectarTransiciones: sin reportar", () => {
	test("última señal reciente: no genera evento", () => {
		const eventos = detectarTransiciones(
			telemetria({ ultimoMensajeAt: ahora }),
			null,
			ahora,
		);
		expect(eventos.some((e) => e.tipo === "sin_reportar")).toBe(false);
	});

	test("cruza el umbral de 2h justo en esta corrida: SÍ genera evento", () => {
		const haceTresHoras = new Date(ahora.getTime() - 3 * 60 * 60 * 1000);
		const eventos = detectarTransiciones(
			telemetria({ ultimoMensajeAt: haceTresHoras }),
			{
				pwrExt: 12.9,
				ignicionOn: false,
				sinReportarDesde: null,
				dentroDeGeocerca: null,
			},
			ahora,
		);
		expect(eventos.some((e) => e.tipo === "sin_reportar")).toBe(true);
	});

	test("ya estaba marcada sin_reportar_desde: NO repite el evento en la siguiente corrida", () => {
		const haceCuatroHoras = new Date(ahora.getTime() - 4 * 60 * 60 * 1000);
		const eventos = detectarTransiciones(
			telemetria({ ultimoMensajeAt: haceCuatroHoras }),
			{
				pwrExt: 12.9,
				ignicionOn: false,
				sinReportarDesde: new Date(ahora.getTime() - 60 * 60 * 1000),
				dentroDeGeocerca: null,
			},
			ahora,
		);
		expect(eventos.some((e) => e.tipo === "sin_reportar")).toBe(false);
	});

	test("ultimoMensajeAt null (nunca reportó): cuenta como sin reportar", () => {
		const eventos = detectarTransiciones(
			telemetria({ ultimoMensajeAt: null }),
			null,
			ahora,
		);
		expect(eventos.some((e) => e.tipo === "sin_reportar")).toBe(true);
	});
});

describe("CB-119 — detectarTransiciones: varios eventos a la vez", () => {
	test("energía Y ignición en la misma corrida: devuelve ambos", () => {
		const eventos = detectarTransiciones(
			telemetria({ pwrExt: 1.0, ignicionOn: true }),
			{
				pwrExt: 12.9,
				ignicionOn: false,
				sinReportarDesde: null,
				dentroDeGeocerca: null,
			},
			ahora,
		);
		const tipos = eventos.map((e) => e.tipo).sort();
		expect(tipos).toEqual(["desconexion_energia", "ignicion"]);
	});
});

describe("CB-119 — detectarTransiciones: salida de geocerca", () => {
	test("transición de dentro a fuera: SÍ genera evento", () => {
		const eventos = detectarTransiciones(
			telemetria(),
			{
				pwrExt: 12.9,
				ignicionOn: false,
				sinReportarDesde: null,
				dentroDeGeocerca: true,
			},
			ahora,
			false, // dentroDeGeocercaAhora
		);
		expect(eventos.some((e) => e.tipo === "salida_geocerca")).toBe(true);
	});

	test("sin snapshot previo (primera vez) y ya está afuera: SÍ genera evento", () => {
		const eventos = detectarTransiciones(telemetria(), null, ahora, false);
		expect(eventos.some((e) => e.tipo === "salida_geocerca")).toBe(true);
	});

	test("ya estaba afuera: NO repite el evento", () => {
		const eventos = detectarTransiciones(
			telemetria(),
			{
				pwrExt: 12.9,
				ignicionOn: false,
				sinReportarDesde: null,
				dentroDeGeocerca: false,
			},
			ahora,
			false,
		);
		expect(eventos.some((e) => e.tipo === "salida_geocerca")).toBe(false);
	});

	test("regresó a Guatemala: NO genera evento (solo interesa la salida)", () => {
		const eventos = detectarTransiciones(
			telemetria(),
			{
				pwrExt: 12.9,
				ignicionOn: false,
				sinReportarDesde: null,
				dentroDeGeocerca: false,
			},
			ahora,
			true,
		);
		expect(eventos.some((e) => e.tipo === "salida_geocerca")).toBe(false);
	});

	test("no se pudo evaluar esta corrida (null): NO genera evento aunque antes estuviera dentro", () => {
		const eventos = detectarTransiciones(
			telemetria(),
			{
				pwrExt: 12.9,
				ignicionOn: false,
				sinReportarDesde: null,
				dentroDeGeocerca: true,
			},
			ahora,
			null, // dentroDeGeocercaAhora: no se pudo leer la geocerca esta corrida
		);
		expect(eventos.some((e) => e.tipo === "salida_geocerca")).toBe(false);
	});

	test("parámetro dentroDeGeocercaAhora omitido: default null, no genera evento", () => {
		const eventos = detectarTransiciones(
			telemetria(),
			{
				pwrExt: 12.9,
				ignicionOn: false,
				sinReportarDesde: null,
				dentroDeGeocerca: true,
			},
			ahora,
		);
		expect(eventos.some((e) => e.tipo === "salida_geocerca")).toBe(false);
	});
});

describe("CB-119 — esPoligonoValido (bug crítico de falso positivo masivo)", () => {
	test("polígono válido (tipo 2, 3+ puntos): true", () => {
		expect(
			esPoligonoValido({
				t: 2,
				p: [
					{ x: 0, y: 0 },
					{ x: 1, y: 0 },
					{ x: 1, y: 1 },
				],
			}),
		).toBe(true);
	});

	test("zona vacía (0 puntos): false, NO true por accidente", () => {
		expect(esPoligonoValido({ t: 2, p: [] })).toBe(false);
	});

	test("menos de 3 puntos (línea corrupta): false", () => {
		expect(esPoligonoValido({ t: 2, p: [{ x: 0, y: 0 }] })).toBe(false);
	});

	test("tipo distinto de polígono (1 = línea, 3 = círculo): false", () => {
		expect(
			esPoligonoValido({
				t: 1,
				p: [
					{ x: 0, y: 0 },
					{ x: 1, y: 0 },
					{ x: 1, y: 1 },
				],
			}),
		).toBe(false);
	});

	test("zona null (Wialon no la devolvió): false", () => {
		expect(esPoligonoValido(null)).toBe(false);
	});

	test("p no es un arreglo (forma corrupta): false", () => {
		expect(esPoligonoValido({ t: 2, p: "no es un arreglo" as never })).toBe(
			false,
		);
	});

	test("vértice con x/y no numéricos (NaN): false — sin esto, puntoDentroDePoligono devuelve false para CUALQUIER coordenada (todas las comparaciones contra NaN son false), disparando una alerta masiva falsa", () => {
		expect(
			esPoligonoValido({
				t: 2,
				p: [
					{ x: 0, y: 0 },
					{ x: Number.NaN, y: 0 },
					{ x: 1, y: 1 },
				],
			}),
		).toBe(false);
	});

	test("vértice con x/y faltantes o de otro tipo (respuesta corrupta de Wialon, cast desde unknown): false", () => {
		expect(
			esPoligonoValido({
				t: 2,
				p: [{ x: 0, y: 0 }, { x: 1 } as never, { x: 1, y: 1 }],
			}),
		).toBe(false);
		expect(
			esPoligonoValido({
				t: 2,
				p: [
					{ x: 0, y: 0 },
					{ x: "1" as never, y: 0 },
					{ x: 1, y: 1 },
				],
			}),
		).toBe(false);
	});
});
