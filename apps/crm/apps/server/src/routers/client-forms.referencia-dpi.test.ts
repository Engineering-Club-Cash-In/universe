import { describe, expect, test } from "bun:test";
import {
	creditApplicationServerSchema,
	MAX_REFERENCIAS_POR_LISTA,
} from "./client-forms";

// Es el esquema con el que `submitCreditApplication` lee el envío público. Si
// `referenciaPersonalServerSchema` no declara `dpi`, zod descarta la clave en
// silencio y se pierden todos los DPI de las referencias.
describe("envío de la solicitud: DPI de las referencias personales", () => {
	test("el dpi de cada referencia sobrevive al esquema del servidor", () => {
		const r = creditApplicationServerSchema.safeParse({
			referenciasPersonales: [
				{
					nombre: "Rosa",
					relacion: "tía",
					telefono: "55551234",
					dpi: "1234567030101",
				},
				{ nombre: "Sin DPI", relacion: "amigo", telefono: "44445678" },
			],
		});
		expect(r.success).toBe(true);
		if (!r.success) return;
		expect(r.data.referenciasPersonales?.[0]?.dpi).toBe("1234567030101");
		expect(r.data.referenciasPersonales?.[1]?.dpi).toBeUndefined();
	});

	test("el dpi de las referencias familiares (llave legada referenciasCrediticias) también sobrevive", () => {
		const r = creditApplicationServerSchema.safeParse({
			referenciasCrediticias: [
				{ nombre: "Tío", telefono: "55551234", dpi: "1234567030101" },
				{ nombre: "Sin DPI", telefono: "44445678" },
			],
		});
		expect(r.success).toBe(true);
		if (!r.success) return;
		expect(r.data.referenciasCrediticias?.[0]?.dpi).toBe("1234567030101");
		expect(r.data.referenciasCrediticias?.[1]?.dpi).toBeUndefined();
	});

	test("un DPI mal escrito de una referencia NO rechaza el envío público", () => {
		const r = creditApplicationServerSchema.safeParse({
			referenciasPersonales: [{ nombre: "X", dpi: "123" }],
			referenciasCrediticias: [{ nombre: "Y", dpi: "123" }],
		});
		expect(r.success).toBe(true);
	});
});

describe("envío de la solicitud: tope de referencias por lista", () => {
	const referencias = (n: number) =>
		Array.from({ length: n }, (_, i) => ({
			nombre: `Ref ${i}`,
			telefono: "55551234",
		}));

	test("un envío real (3 por lista) y uno con 10 por lista pasan", () => {
		for (const n of [3, MAX_REFERENCIAS_POR_LISTA]) {
			const r = creditApplicationServerSchema.safeParse({
				referenciasPersonales: referencias(n),
				referenciasCrediticias: referencias(n),
			});
			expect(r.success).toBe(true);
		}
	});

	test.each([
		"referenciasPersonales",
		"referenciasCrediticias",
	])("más de 10 en %s se rechaza", (lista) => {
		const r = creditApplicationServerSchema.safeParse({
			[lista]: referencias(MAX_REFERENCIAS_POR_LISTA + 1),
		});
		expect(r.success).toBe(false);
	});
});
