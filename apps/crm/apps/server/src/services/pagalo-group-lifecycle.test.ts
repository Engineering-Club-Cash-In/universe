/**
 * Solo la parte pura de pagalo-group-lifecycle.ts (CB-127): la que no
 * necesita DB. El resto (invalidarGrupoEnTx, proximaGeneracion) toca
 * candados y WHERE condicionales — mockear el `tx` de Drizzle daría falsa
 * confianza justo ahí, así que queda sin cobertura automática hasta que
 * exista infra de DB de test (deuda declarada, no disimulada).
 */

import { describe, expect, test } from "bun:test";
import { esViolacionDeUnicidadPagalo } from "./pagalo-group-lifecycle";

describe("esViolacionDeUnicidadPagalo", () => {
	test("detecta código 23505 directo", () => {
		expect(esViolacionDeUnicidadPagalo({ code: "23505" })).toBe(true);
	});

	test("detecta código 23505 anidado en cause", () => {
		expect(
			esViolacionDeUnicidadPagalo({
				message: "insert failed",
				cause: { code: "23505" },
			}),
		).toBe(true);
	});

	test("detecta código 23505 anidado en varios niveles de cause", () => {
		expect(
			esViolacionDeUnicidadPagalo({
				cause: { cause: { cause: { code: "23505" } } },
			}),
		).toBe(true);
	});

	test("rechaza otros códigos de error de Postgres", () => {
		expect(esViolacionDeUnicidadPagalo({ code: "23503" })).toBe(false);
	});

	test("rechaza errores sin code", () => {
		expect(esViolacionDeUnicidadPagalo(new Error("algo falló"))).toBe(false);
	});

	test("rechaza valores que no son objetos", () => {
		expect(esViolacionDeUnicidadPagalo("23505")).toBe(false);
		expect(esViolacionDeUnicidadPagalo(null)).toBe(false);
		expect(esViolacionDeUnicidadPagalo(undefined)).toBe(false);
		expect(esViolacionDeUnicidadPagalo(23505)).toBe(false);
	});
});
