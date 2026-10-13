import { describe, expect, test } from "bun:test";
import { paginasAPedir } from "./use-solicitudes";

describe("paginasAPedir", () => {
	test("sin total todavía, solo la primera", () => {
		expect(paginasAPedir(3, undefined, 50)).toBe(1);
		expect(paginasAPedir(3, null, 50)).toBe(1);
	});

	test("las que pidió «Cargar más» mientras existan", () => {
		expect(paginasAPedir(2, 120, 50)).toBe(2);
	});

	test("una fuente agotada no pide páginas vacías", () => {
		expect(paginasAPedir(5, 120, 50)).toBe(3);
		expect(paginasAPedir(5, 0, 50)).toBe(1);
	});

	test("respeta el límite del servidor", () => {
		expect(paginasAPedir(150, 100_000, 50, 100)).toBe(100);
	});
});
