/**
 * Pruebas del modo simulado.
 *
 * El resto de `otp.ts` (envío, validación, intentos) necesita base de datos y se
 * prueba contra dev; acá va lo que decide si el código es el fijo de pruebas o
 * uno aleatorio. Lo que se cuida es que **sin la env** siempre salga aleatorio:
 * es lo único que separa a producción del código quemado.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { elegirCodigo, esModoSimulado } from "./otp";

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

describe("elegirCodigo", () => {
	const original = process.env.BOT_COBROS_OTP_SIMULADO;

	afterEach(() => {
		if (original === undefined) {
			delete process.env.BOT_COBROS_OTP_SIMULADO;
		} else {
			process.env.BOT_COBROS_OTP_SIMULADO = original;
		}
	});

	test("en modo simulado el código es fijo, para cualquier cliente", () => {
		process.env.BOT_COBROS_OTP_SIMULADO = "true";
		expect(elegirCodigo()).toEqual({ codigo: "4321", fijo: true });
	});

	// Lo único que separa a producción del código quemado. Si esto se rompe, el
	// OTP deja de proteger nada.
	test("sin la env, SIEMPRE aleatorio", () => {
		delete process.env.BOT_COBROS_OTP_SIMULADO;

		const codigos = new Set<string>();

		for (let i = 0; i < 200; i++) {
			const { codigo, fijo } = elegirCodigo();

			expect(fijo).toBe(false);
			expect(codigo).toMatch(/^\d{4}$/);
			codigos.add(codigo);
		}

		// Con 200 tiradas sobre 9,000 valores, repetirse tanto como para bajar de
		// 100 distintos sería el generador atascado, no la casualidad.
		expect(codigos.size).toBeGreaterThan(100);
	});

	test("un valor cualquiera en la env tampoco lo prende", () => {
		process.env.BOT_COBROS_OTP_SIMULADO = "false";
		expect(elegirCodigo().fijo).toBe(false);
	});
});
