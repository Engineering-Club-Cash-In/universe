import { describe, expect, test } from "bun:test";
import {
	armarContextoIA,
	asistenteActivo,
	huellaContexto,
	taparNumeros,
} from "./asistente-ia-cobros";

const fuentes = {
	caso: {
		estadoMora: "mora_30",
		diasMoraMaximo: 35,
		cuotasVencidas: 1,
		montoEnMora: "1500.00",
	},
	hitos: [
		{
			id: "b1",
			descripcion: "Ingresó a Bucket B1",
			fecha: "2026-09-10T06:05:00.000Z",
			tipo: "bucket" as const,
		},
	],
	gestiones: [
		{
			fechaContacto: new Date("2026-10-01T15:30:00Z"),
			metodoContacto: "llamada",
			estadoContacto: "promesa_pago",
			comentarios: " Dice que paga el viernes, llamar al 5555 1234 ",
			montoComprometido: "500.00",
			fechaProximoContacto: new Date("2026-10-03T06:00:00Z"),
			estadoPromesa: "pendiente",
		},
	],
};

describe("taparNumeros", () => {
	test("tapa teléfonos y DPI, deja montos y fechas", () => {
		expect(taparNumeros("tel 5555-1234, dpi 2993 06216 0101")).toBe(
			"tel [número], dpi [número]",
		);
		expect(taparNumeros("pagará Q1500 el 3/10")).toBe("pagará Q1500 el 3/10");
	});
});

describe("armarContextoIA", () => {
	test("sin datos personales y con los números tapados", () => {
		const c = armarContextoIA(fuentes);
		expect(c.gestiones[0]).toEqual({
			fecha: "2026-10-01T15:30",
			metodo: "llamada",
			resultado: "promesa_pago",
			comentario: "Dice que paga el viernes, llamar al [número]",
			montoPrometido: "500.00",
			fechaPrometida: "2026-10-03",
			estadoPromesa: "pendiente",
		});
		expect(c.hitos).toEqual([
			{ fecha: "2026-09-10", descripcion: "Ingresó a Bucket B1" },
		]);
	});
	test("la huella es estable y cambia con una gestión nueva", () => {
		const a = huellaContexto(armarContextoIA(fuentes));
		expect(huellaContexto(armarContextoIA(fuentes))).toBe(a);
		const otra = armarContextoIA({
			...fuentes,
			gestiones: [
				{ ...fuentes.gestiones[0], estadoContacto: "no_contesta" },
				...fuentes.gestiones,
			],
		});
		expect(huellaContexto(otra)).not.toBe(a);
	});
});

describe("asistenteActivo", () => {
	test("solo con la bandera en «on» y la key", () => {
		const antes = { ...process.env };
		process.env.GOOGLE_GENERATIVE_AI_API_KEY = "x";
		process.env.COBROS_ASISTENTE_IA = "";
		expect(asistenteActivo()).toBe(false);
		process.env.COBROS_ASISTENTE_IA = "on";
		expect(asistenteActivo()).toBe(true);
		process.env.GOOGLE_GENERATIVE_AI_API_KEY = "";
		expect(asistenteActivo()).toBe(false);
		process.env = antes;
	});
});
