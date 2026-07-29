import { describe, expect, test } from "bun:test";
import {
	calcularAjusteFechaIdeal,
	getDiaPagoOriginalSistema,
} from "./fecha-ideal-pago-ajuste";

describe("getDiaPagoOriginalSistema", () => {
	test("día 15 (≤20) devuelve 15", () => {
		expect(getDiaPagoOriginalSistema(new Date("2026-07-15T18:00:00Z"))).toBe(
			15,
		);
	});

	test("día 20 exacto (≤20) devuelve 15", () => {
		expect(getDiaPagoOriginalSistema(new Date("2026-07-20T18:00:00Z"))).toBe(
			15,
		);
	});

	test("día 21 (>20) devuelve 30", () => {
		expect(getDiaPagoOriginalSistema(new Date("2026-07-21T18:00:00Z"))).toBe(
			30,
		);
	});

	test("día 27 (>20) devuelve 30", () => {
		expect(getDiaPagoOriginalSistema(new Date("2026-07-27T18:00:00Z"))).toBe(
			30,
		);
	});
});

describe("calcularAjusteFechaIdeal", () => {
	test("día IA después del original: prorratea interés, membresía y servicios", () => {
		// fechaReferencia en marzo (hora Guatemala) → primera cuota cae en abril (30 días)
		const fechaReferencia = new Date("2026-03-10T18:00:00Z");

		const resultado = calcularAjusteFechaIdeal({
			diaPagoOriginalSistema: 15,
			diaPagoMensualElegido: 17,
			capital: 10000,
			porcentajeInteres: 3, // interés mensual = 300
			membresiaMensual: 90,
			seguroMensual: 45,
			gpsMensual: 15, // servicios = 60
			fechaReferencia,
		});

		expect(resultado).not.toBeNull();
		expect(resultado?.diasDiferencia).toBe(2);
		expect(resultado?.diasDelMes).toBe(30);
		expect(resultado?.montoInteres).toBe(20); // (300/30)*2
		expect(resultado?.montoMembresia).toBe(6); // (90/30)*2
		expect(resultado?.montoServicios).toBe(4); // (60/30)*2
		expect(resultado?.montoTotal).toBe(30);
	});

	test("redondea a 2 decimales cuando la división no es exacta", () => {
		// fechaReferencia en junio (hora Guatemala) → primera cuota cae en julio (31 días)
		const fechaReferencia = new Date("2026-06-10T18:00:00Z");

		const resultado = calcularAjusteFechaIdeal({
			diaPagoOriginalSistema: 15,
			diaPagoMensualElegido: 17,
			capital: 10000,
			porcentajeInteres: 1, // interés mensual = 100
			membresiaMensual: 50,
			seguroMensual: 20,
			gpsMensual: 10, // servicios = 30
			fechaReferencia,
		});

		expect(resultado?.diasDelMes).toBe(31);
		expect(resultado?.montoInteres).toBe(6.45); // (100/31)*2 = 6.4516...
		expect(resultado?.montoMembresia).toBe(3.23); // (50/31)*2 = 3.2258...
		expect(resultado?.montoServicios).toBe(1.94); // (30/31)*2 = 1.9354...
		expect(resultado?.montoTotal).toBe(11.62);
	});

	test("día IA igual al original: no hay ajuste (null)", () => {
		const resultado = calcularAjusteFechaIdeal({
			diaPagoOriginalSistema: 15,
			diaPagoMensualElegido: 15,
			capital: 10000,
			porcentajeInteres: 3,
			membresiaMensual: 90,
			seguroMensual: 45,
			gpsMensual: 15,
		});

		expect(resultado).toBeNull();
	});

	test("día IA antes del original: no hay ajuste (null), no negativo", () => {
		const resultado = calcularAjusteFechaIdeal({
			diaPagoOriginalSistema: 30,
			diaPagoMensualElegido: 17,
			capital: 10000,
			porcentajeInteres: 3,
			membresiaMensual: 90,
			seguroMensual: 45,
			gpsMensual: 15,
		});

		expect(resultado).toBeNull();
	});

	test("usa hora Guatemala para el mes de la primera cuota, no la hora local del server", () => {
		// 2026-02-01T01:00:00Z = 31 de enero, 7pm hora Guatemala (UTC-6) — sigue
		// siendo enero en GT aunque ya sea 1 de febrero en UTC. Antes del fix,
		// getFullYear()/getMonth() en un server UTC leían "febrero" acá y el
		// denominador salía calculado con el mes equivocado.
		const fechaReferencia = new Date("2026-02-01T01:00:00Z");

		const resultado = calcularAjusteFechaIdeal({
			diaPagoOriginalSistema: 15,
			diaPagoMensualElegido: 17,
			capital: 10000,
			porcentajeInteres: 1,
			membresiaMensual: 0,
			seguroMensual: 0,
			gpsMensual: 0,
			fechaReferencia,
		});

		// Enero (GT) → primera cuota en febrero de 2026 (no bisiesto) = 28 días
		expect(resultado?.diasDelMes).toBe(28);
	});

	test("clampa el día elegido al último día del mes si el mes tiene menos días (día 31 en abril de 30 días)", () => {
		const fechaReferencia = new Date("2026-03-10T18:00:00Z"); // marzo GT → primera cuota en abril (30 días)

		const resultado = calcularAjusteFechaIdeal({
			diaPagoOriginalSistema: 15,
			diaPagoMensualElegido: 31,
			capital: 10000,
			porcentajeInteres: 3,
			membresiaMensual: 0,
			seguroMensual: 0,
			gpsMensual: 0,
			fechaReferencia,
		});

		expect(resultado?.diasDelMes).toBe(30);
		// 30 - 15 = 15, NO 31 - 15 = 16 (el día 31 no existe en abril)
		expect(resultado?.diasDiferencia).toBe(15);
	});

	test("clampa hasta 3 días de diferencia en febrero (el mes más corto)", () => {
		const fechaReferencia = new Date("2026-01-10T18:00:00Z"); // enero GT → primera cuota en febrero (28 días, 2026 no bisiesto)

		const resultado = calcularAjusteFechaIdeal({
			diaPagoOriginalSistema: 15,
			diaPagoMensualElegido: 31,
			capital: 10000,
			porcentajeInteres: 3,
			membresiaMensual: 0,
			seguroMensual: 0,
			gpsMensual: 0,
			fechaReferencia,
		});

		expect(resultado?.diasDelMes).toBe(28);
		// 28 - 15 = 13, NO 31 - 15 = 16
		expect(resultado?.diasDiferencia).toBe(13);
	});
});
