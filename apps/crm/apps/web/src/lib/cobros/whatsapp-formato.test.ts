import { describe, expect, test } from "bun:test";
import {
	segmentarNegritasWhatsapp,
	tieneNegritasWhatsapp,
} from "./whatsapp-formato";

const soloTipoYValor = (texto: string) =>
	segmentarNegritasWhatsapp(texto).map(({ tipo, valor }) => ({ tipo, valor }));

describe("formato de negritas de WhatsApp", () => {
	test("separa el texto normal de la negrita", () => {
		expect(soloTipoYValor("Tipo: *Monetaria*")).toEqual([
			{ tipo: "texto", valor: "Tipo: " },
			{ tipo: "negrita", valor: "Monetaria" },
		]);
	});

	test("la negrita puede ir en medio y con puntuación pegada afuera", () => {
		expect(
			soloTipoYValor("¡Bienvenido(a) a *CashIn*! Nos alegra acompañarte."),
		).toEqual([
			{ tipo: "texto", valor: "¡Bienvenido(a) a " },
			{ tipo: "negrita", valor: "CashIn" },
			{ tipo: "texto", valor: "! Nos alegra acompañarte." },
		]);
	});

	test("los bullets `* BI:` de las cuentas NO son negrita (asterisco + espacio)", () => {
		const cuentas =
			"* BI: 5520029876\n* BAM: 3020123033\n* GyT: 01300039945\n* Banrural: 3394002346";

		expect(tieneNegritasWhatsapp(cuentas)).toBe(false);
		expect(soloTipoYValor(cuentas)).toEqual([
			{ tipo: "texto", valor: cuentas },
		]);
	});

	test("la negrita no cruza saltos de línea", () => {
		// El `*` que cierra una línea y el que abre la siguiente no se emparejan
		// entre sí: cada línea resuelve sus propias negritas.
		expect(
			soloTipoYValor(
				"🚗 *Tu vehículo cuenta con seguro.*\n*En caso de accidente, llama al 2384-7400*, con tu placa.",
			),
		).toEqual([
			{ tipo: "texto", valor: "🚗 " },
			{ tipo: "negrita", valor: "Tu vehículo cuenta con seguro." },
			{ tipo: "texto", valor: "\n" },
			{ tipo: "negrita", valor: "En caso de accidente, llama al 2384-7400" },
			{ tipo: "texto", valor: ", con tu placa." },
		]);
	});

	test("un asterisco sin pareja se muestra literal", () => {
		expect(soloTipoYValor("Hola *mundo")).toEqual([
			{ tipo: "texto", valor: "Hola *mundo" },
		]);
		expect(tieneNegritasWhatsapp("* solo un bullet")).toBe(false);
	});

	test("las variables {llaves} dentro de la negrita se conservan", () => {
		expect(soloTipoYValor("Día de pago mensual: *{fechaPago}*")).toEqual([
			{ tipo: "texto", valor: "Día de pago mensual: " },
			{ tipo: "negrita", valor: "{fechaPago}" },
		]);
	});

	test("las posiciones de inicio son únicas y crecientes (llaves estables)", () => {
		const segmentos = segmentarNegritasWhatsapp("Hola *a*\n*b* y *c*\nfin");
		const inicios = segmentos.map((s) => s.inicio);

		expect(new Set(inicios).size).toBe(inicios.length);
		expect([...inicios].sort((x, y) => x - y)).toEqual(inicios);
	});
});
