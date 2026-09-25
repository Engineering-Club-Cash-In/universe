/**
 * CB-119 — detectarTransiciones: la lógica pura del job de polling.
 * No toca DB ni Wialon, así que no hace falta mockear nada acá.
 */
import { describe, expect, test } from "bun:test";
import type { WialonTelemetriaUnidad } from "../services/wialon/wialon-types";
import { detectarTransiciones } from "./gps-eventos-poll";

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
			},
			ahora,
		);
		const tipos = eventos.map((e) => e.tipo).sort();
		expect(tipos).toEqual(["desconexion_energia", "ignicion"]);
	});
});
