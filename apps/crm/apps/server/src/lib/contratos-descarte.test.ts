import { beforeAll, describe, expect, test } from "bun:test";
import { descarteValido, firmarDescarte } from "./contratos-descarte";

beforeAll(() => {
	process.env.BETTER_AUTH_SECRET ??= "secreto-de-prueba";
});

describe("comprobante de descarte", () => {
	test("el que firmó el servidor vale para ese documento y esa oportunidad", () => {
		const comprobante = firmarDescarte("opp-1", "doc-1");
		expect(descarteValido("opp-1", "doc-1", comprobante)).toBe(true);
	});

	test("no sirve para otro documento", () => {
		const comprobante = firmarDescarte("opp-1", "doc-1");
		expect(descarteValido("opp-1", "doc-2", comprobante)).toBe(false);
	});

	test("no sirve para otra oportunidad", () => {
		const comprobante = firmarDescarte("opp-1", "doc-1");
		expect(descarteValido("opp-2", "doc-1", comprobante)).toBe(false);
	});

	test("uno inventado no vale", () => {
		expect(descarteValido("opp-1", "doc-1", "abc123")).toBe(false);
		expect(descarteValido("opp-1", "doc-1", "no-es-hex")).toBe(false);
	});
});
