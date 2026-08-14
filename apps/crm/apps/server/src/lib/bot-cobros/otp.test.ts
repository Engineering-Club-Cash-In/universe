/**
 * Pruebas de los candados del modo simulado.
 *
 * El resto de `otp.ts` (envío, validación, intentos) necesita base de datos y se
 * prueba contra dev; acá van solo las dos funciones puras que deciden si se
 * puede revelar un código, porque de eso depende que nadie lea el OTP de un
 * cliente real de la copia de producción.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { esDeDatosDePrueba, esModoSimulado } from "./otp";

describe("esModoSimulado", () => {
	const original = process.env.BOT_COBROS_OTP_SIMULADO;

	afterEach(() => {
		if (original === undefined) {
			delete process.env.BOT_COBROS_OTP_SIMULADO;
		} else {
			process.env.BOT_COBROS_OTP_SIMULADO = original;
		}
	});

	test("apagado por defecto: sin la env, se manda el SMS de verdad", () => {
		delete process.env.BOT_COBROS_OTP_SIMULADO;
		expect(esModoSimulado()).toBe(false);
	});

	test("se prende con 'true' o '1'", () => {
		process.env.BOT_COBROS_OTP_SIMULADO = "true";
		expect(esModoSimulado()).toBe(true);

		process.env.BOT_COBROS_OTP_SIMULADO = "1";
		expect(esModoSimulado()).toBe(true);
	});

	test("cualquier otro valor NO lo prende", () => {
		for (const valor of ["false", "0", "", "TRUE", "si"]) {
			process.env.BOT_COBROS_OTP_SIMULADO = valor;
			expect(esModoSimulado()).toBe(false);
		}
	});
});

describe("esDeDatosDePrueba", () => {
	const leadDePrueba = "b0710000-0000-4000-8000-000000000001";
	const codeudorDePrueba = "b0740000-0000-4000-8000-000000000008";
	const leadReal = "17c5e9f9-6cad-464a-8d00-902e0e335c1a";

	test("acepta un lead sembrado", () => {
		expect(esDeDatosDePrueba([leadDePrueba, null])).toBe(true);
	});

	test("acepta un codeudor sembrado", () => {
		expect(esDeDatosDePrueba([null, codeudorDePrueba])).toBe(true);
	});

	test("rechaza a un cliente real", () => {
		expect(esDeDatosDePrueba([leadReal, null])).toBe(false);
	});

	// Hoy no se da (el servicio 1 llena uno u otro), pero si mañana se llenaran
	// los dos, un codeudor ficticio no debe destapar el código de un lead real.
	test("rechaza mezclas: basta un id real para negar", () => {
		expect(esDeDatosDePrueba([leadReal, codeudorDePrueba])).toBe(false);
	});

	test("rechaza una fila sin ids", () => {
		expect(esDeDatosDePrueba([null, null])).toBe(false);
	});
});
