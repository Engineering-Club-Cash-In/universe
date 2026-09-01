/**
 * La red de seguridad del modo prueba.
 *
 * Hasta 2026-09-01 respetar `TEST_MESSAGE` era una convención por emisor, y
 * con doce emisores ya se había escapado uno: `bot-cobros/eventos-pago.ts`
 * —el aviso de rechazo al cliente— mandaba al teléfono real aunque el modo
 * prueba estuviera activo, disparado por un job que corre solo cada 3 h contra
 * una copia de producción. Estas pruebas cuidan que la protección viva en la
 * puerta de salida y no dependa de que alguien se acuerde.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
	esTelefonoDePrueba,
	getTestPhone,
	redirigirSiEsPrueba,
	TEST_PHONES,
} from "./messaging-test-mode";

const original = process.env.TEST_MESSAGE;
const CLIENTE_REAL = "+50245678901";

beforeEach(() => {
	process.env.TEST_MESSAGE = "true";
});

afterEach(() => {
	if (original === undefined) delete process.env.TEST_MESSAGE;
	else process.env.TEST_MESSAGE = original;
});

describe("redirigirSiEsPrueba", () => {
	test("con el modo activo, un cliente real nunca es el destino", () => {
		const r = redirigirSiEsPrueba(CLIENTE_REAL);
		expect(r.redirigido).toBe(true);
		expect(r.destino).not.toBe(CLIENTE_REAL);
		expect(esTelefonoDePrueba(r.destino)).toBe(true);
	});

	test("el destinatario real se conserva para trazabilidad", () => {
		expect(redirigirSiEsPrueba(CLIENTE_REAL).realTarget).toBe(CLIENTE_REAL);
	});

	test("sin el modo activo no toca nada", () => {
		for (const valor of ["false", "0", "", undefined]) {
			if (valor === undefined) delete process.env.TEST_MESSAGE;
			else process.env.TEST_MESSAGE = valor;
			const r = redirigirSiEsPrueba(CLIENTE_REAL);
			expect(r.destino).toBe(CLIENTE_REAL);
			expect(r.redirigido).toBe(false);
		}
	});

	test("'1' también cuenta como modo prueba", () => {
		process.env.TEST_MESSAGE = "1";
		expect(redirigirSiEsPrueba(CLIENTE_REAL).redirigido).toBe(true);
	});

	describe("idempotencia con los emisores que ya redirigían", () => {
		test("un teléfono de prueba se deja tal cual", () => {
			// Los once emisores que ya llamaban a getTestPhone() llegan acá con el
			// número ya cambiado; volver a redirigir no debe alterarlo.
			for (const p of TEST_PHONES) {
				const r = redirigirSiEsPrueba(`+502${p}`);
				expect(r.destino).toBe(`+502${p}`);
				expect(r.redirigido).toBe(false);
			}
		});

		test("no colapsa la rotación de un masivo en un solo número", () => {
			// send-premora/convenio rotan con getTestPhone(i) justamente para no
			// mandarle 200 mensajes al mismo teléfono. Si la red re-redirigiera,
			// todos volverían a caer en TEST_PHONES[0].
			const destinos = TEST_PHONES.map(
				(_, i) => redirigirSiEsPrueba(`+502${getTestPhone(i)}`).destino,
			);
			expect(new Set(destinos).size).toBe(TEST_PHONES.length);
		});
	});

	test("el índice rota para quien NO redirigió por su cuenta", () => {
		const destinos = Array.from(
			{ length: TEST_PHONES.length },
			(_, i) => redirigirSiEsPrueba(`+5024567890${i}`, i).destino,
		);
		expect(new Set(destinos).size).toBe(TEST_PHONES.length);
	});

	test("el índice da la vuelta sin salirse de la lista", () => {
		const r = redirigirSiEsPrueba(CLIENTE_REAL, TEST_PHONES.length + 3);
		expect(esTelefonoDePrueba(r.destino)).toBe(true);
	});
});

describe("esTelefonoDePrueba", () => {
	test("un cliente real no lo es", () => {
		expect(esTelefonoDePrueba(CLIENTE_REAL)).toBe(false);
	});

	test("compara el número completo, no el sufijo", () => {
		// "+5021158446376" termina en un teléfono de prueba pero no lo es.
		expect(esTelefonoDePrueba(`+50211${TEST_PHONES[0]}`)).toBe(false);
	});
});
