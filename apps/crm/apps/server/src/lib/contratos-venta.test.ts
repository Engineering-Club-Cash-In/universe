import { describe, expect, test } from "bun:test";
import { contratosParaSubirAMano } from "./contratos-venta";

describe("qué se puede subir a mano", () => {
	test("una sociedad: los de sociedad y la declaración del vendedor", () => {
		const tipos = contratosParaSubirAMano(true);
		expect(tipos).toContain("garantia_mobiliaria_sociedad");
		expect(tipos).toContain("declaracion_vendedor");
		expect(tipos).not.toContain("garantia_mobiliaria");
	});

	test("una persona: sólo los individuales", () => {
		const tipos = contratosParaSubirAMano(false);
		expect(tipos).toContain("garantia_mobiliaria");
		expect(tipos).toContain("declaracion_vendedor");
		expect(tipos.some((t) => t.endsWith("_sociedad"))).toBe(false);
	});
});
