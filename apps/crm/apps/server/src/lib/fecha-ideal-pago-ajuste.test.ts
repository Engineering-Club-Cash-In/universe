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
	test("prorratea el interés bruto con IVA, membresía y servicios por componente", () => {
		// fechaReferencia en marzo (hora Guatemala) → primera cuota cae en abril (30 días)
		const fechaReferencia = new Date("2026-03-10T18:00:00Z");

		const resultado = calcularAjusteFechaIdeal({
			diaPagoOriginalSistema: 15,
			diaPagoMensualElegido: 17,
			capital: 10000,
			porcentajeInteres: 3, // interés base Q300 + IVA Q36 = Q336
			membresiaMensual: 90,
			seguroMensual: 45,
			gpsMensual: 15, // servicios = 60
			fechaReferencia,
		});

		expect(resultado).not.toBeNull();
		expect(resultado?.diasDiferencia).toBe(2);
		expect(resultado?.diasDelMes).toBe(30);
		expect(resultado?.montoInteres).toBe(22.4); // (336/30)*2
		expect(resultado?.montoMembresia).toBe(6); // (90/30)*2
		expect(resultado?.montoServicios).toBe(4); // (60/30)*2
		expect(resultado?.montoTotal).toBe(32.4);
	});

	test("redondea a 2 decimales cuando la división no es exacta", () => {
		// fechaReferencia en junio (hora Guatemala) → primera cuota cae en julio (31 días)
		const fechaReferencia = new Date("2026-06-10T18:00:00Z");

		const resultado = calcularAjusteFechaIdeal({
			diaPagoOriginalSistema: 15,
			diaPagoMensualElegido: 17,
			capital: 10000,
			porcentajeInteres: 1, // interés base Q100 + IVA Q12 = Q112
			membresiaMensual: 50,
			seguroMensual: 20,
			gpsMensual: 10, // servicios = 30
			fechaReferencia,
		});

		expect(resultado?.diasDelMes).toBe(31);
		expect(resultado?.montoInteres).toBe(7.23); // (112/31)*2 = 7.2258...
		expect(resultado?.montoMembresia).toBe(3.23); // (50/31)*2 = 3.2258...
		expect(resultado?.montoServicios).toBe(1.94); // (30/31)*2 = 1.9354...
		expect(resultado?.montoTotal).toBe(12.4);
	});

	test("prorratea Q1,000 de interés mensual ya con IVA a Q366.67 por 11/30 días", () => {
		const resultado = calcularAjusteFechaIdeal({
			diaPagoOriginalSistema: 15,
			diaPagoMensualElegido: 26,
			capital: 89286,
			porcentajeInteres: 1, // base Q892.86 + IVA Q107.14 = Q1,000
			membresiaMensual: 0,
			seguroMensual: 0,
			gpsMensual: 0,
			fechaReferencia: new Date("2026-03-10T18:00:00Z"),
		});

		expect(resultado?.diasDiferencia).toBe(11);
		expect(resultado?.diasDelMes).toBe(30);
		expect(resultado?.montoInteres).toBe(366.67);
		expect(resultado?.montoTotal).toBe(366.67);
	});

	test("redondea primero el interés base y luego su IVA antes de prorratear", () => {
		const resultado = calcularAjusteFechaIdeal({
			diaPagoOriginalSistema: 14,
			diaPagoMensualElegido: 28,
			capital: 0.5,
			porcentajeInteres: 1, // Q0.005 -> base Q0.01; IVA Q0.00
			membresiaMensual: 0,
			seguroMensual: 0,
			gpsMensual: 0,
			fechaReferencia: new Date("2026-01-10T18:00:00Z"),
		});

		// Q0.01 * 14/28 = Q0.005 -> Q0.01. Multiplicar 0.005 por 1.12 daría Q0.00.
		expect(resultado?.montoInteres).toBe(0.01);
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

	test("usa la misma hora del server que generatePaymentDates en cartera-back, no hora Guatemala", () => {
		// 2026-02-01T01:00:00Z = 31 ene 7pm GT, pero ya 1 feb en hora server (UTC).
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

		// Febrero (hora server) → primera cuota en marzo de 2026 = 31 días
		expect(resultado?.diasDelMes).toBe(31);
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

	test.each([
		["2026-01-10T18:00:00Z", 15, 31, 28, 13],
		["2028-01-10T18:00:00Z", 15, 31, 29, 14],
		["2026-03-10T18:00:00Z", 15, 31, 30, 15],
		["2026-02-10T18:00:00Z", 30, 31, 31, 1],
	])("usa meses de 28/29/30/31 días y clampa el elegido (%s)", (fecha, original, elegido, diasDelMes, diasDiferencia) => {
		const resultado = calcularAjusteFechaIdeal({
			diaPagoOriginalSistema: original,
			diaPagoMensualElegido: elegido,
			capital: 10000,
			porcentajeInteres: 3,
			membresiaMensual: 0,
			seguroMensual: 0,
			gpsMensual: 0,
			fechaReferencia: new Date(fecha),
		});

		expect(resultado?.diasDelMes).toBe(diasDelMes);
		expect(resultado?.diasDiferencia).toBe(diasDiferencia);
	});
});
