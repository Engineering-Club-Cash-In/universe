import { describe, expect, test } from "bun:test";
import {
	decodificarCursorBuroInterno,
	codificarCursorBuroInterno,
	TAMANIO_MAXIMO_PAGINA_BURO_INTERNO,
	parsearTamanioPaginaBuroInterno,
} from "./buroInternoCursor";

describe("cursor de créditos para buró interno", () => {
	test("conserva el último ID y el límite superior de la consulta", () => {
		const cursor = { lastCreditoId: 250, maxCreditoId: 9400 };
		expect(decodificarCursorBuroInterno(codificarCursorBuroInterno(cursor))).toEqual(
			cursor,
		);
	});

	test("acepta cursor vacío para iniciar una consulta", () => {
		expect(decodificarCursorBuroInterno(undefined)).toBeNull();
		expect(decodificarCursorBuroInterno("")).toBeNull();
	});

	test.each(["abc", "1", "1:2:3", "-1:2", "3:2", "9007199254740992:9007199254740992"])(
		"rechaza cursor inválido: %s",
		(value) => {
			expect(() => decodificarCursorBuroInterno(value)).toThrow(
				"Cursor de buró inválido",
			);
		},
	);
});

describe("tamaño de página del buró interno", () => {
	test("usa 100 por defecto", () => {
		expect(parsearTamanioPaginaBuroInterno(undefined)).toBe(100);
		expect(parsearTamanioPaginaBuroInterno("")).toBe(100);
	});

	test("acepta valores dentro del rango", () => {
		expect(parsearTamanioPaginaBuroInterno("50")).toBe(50);
		expect(parsearTamanioPaginaBuroInterno(TAMANIO_MAXIMO_PAGINA_BURO_INTERNO)).toBe(
			TAMANIO_MAXIMO_PAGINA_BURO_INTERNO,
		);
	});

	test.each(["0", "1001", "1.5", "NaN", "abc"])(
		"rechaza tamaño inválido: %s",
		(value) => {
			expect(() => parsearTamanioPaginaBuroInterno(value)).toThrow();
		},
	);
});
