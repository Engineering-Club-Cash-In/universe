import { describe, expect, test } from "bun:test";
import {
	armarContextoIA,
	hayQueResumir,
	asistenteActivo,
	huellaContexto,
	palabrasDeNombres,
	taparDatosPersonales,
	taparNumeros,
} from "./asistente-ia-cobros";

const fuentes = {
	credito: {
		estadoMora: "MOROSO",
		diasMora: 35,
		cuotasVencidas: 1,
		moraAcumulada: "1500.00",
		cuotaMensual: "4392.02",
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

describe("taparDatosPersonales", () => {
	const nombres = palabrasDeNombres([
		"María José Pérez de la Cruz",
		"Juan Mora",
		null,
	]);
	test("tapa correos y teléfonos o DPI con puntuación", () => {
		expect(
			taparDatosPersonales("escribe a juan.perez@correo.com o al (502) 5555-1234"),
		).toBe("escribe a [correo] o al [número]");
		expect(taparDatosPersonales("DPI 2993.06216.0101")).toBe("DPI [número]");
	});
	test("tapa los nombres sin importar mayúsculas ni acentos", () => {
		expect(
			taparDatosPersonales("Habló con MARIA jose, esposa de Perez", nombres),
		).toBe("Habló con [nombre] [nombre], esposa de [nombre]");
	});
	test("deja las palabras de cobranza aunque sean apellido", () => {
		expect(taparDatosPersonales("tiene mora y pagó la cuota", nombres)).toBe(
			"tiene mora y pagó la cuota",
		);
		expect(palabrasDeNombres(["Juan Mora del Cid"])).toEqual(
			new Set(["juan", "cid"]),
		);
	});
	test("no toca montos ni fechas con diagonal", () => {
		expect(taparDatosPersonales("pagará Q1,500.00 el 3/10", nombres)).toBe(
			"pagará Q1,500.00 el 3/10",
		);
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
		expect(c.credito).toEqual(fuentes.credito);
		expect(c.hitos).toEqual([
			{ fecha: "2026-09-10", descripcion: "Ingresó a Bucket B1" },
		]);
	});
	test("con nombres, el comentario sale sin ellos", () => {
		const c = armarContextoIA({
			...fuentes,
			nombres: palabrasDeNombres(["Carlos Ramírez"]),
			gestiones: [
				{
					...fuentes.gestiones[0],
					comentarios: "Habló con carlos ramirez, correo cr@x.com",
				},
			],
		});
		expect(c.gestiones[0].comentario).toBe("Habló con [nombre] [nombre], correo [correo]");
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

describe("hayQueResumir", () => {
	const alDia = {
		estadoMora: "al_dia",
		diasMora: 0,
		cuotasVencidas: 0,
		moraAcumulada: "0.00",
		cuotaMensual: "1500.00",
	};
	test("al día y sin historial no hay nada que resumir", () => {
		expect(hayQueResumir({ credito: alDia, hitos: [], gestiones: [] })).toBe(
			false,
		);
	});
	test("en mora basta el estado vivo, sin gestiones ni hitos", () => {
		for (const credito of [
			{ ...alDia, diasMora: 12 },
			{ ...alDia, cuotasVencidas: 1 },
			{ ...alDia, moraAcumulada: "35.50" },
		]) {
			expect(hayQueResumir({ credito, hitos: [], gestiones: [] })).toBe(true);
		}
	});
	test("con gestiones o hitos siempre hay qué resumir", () => {
		expect(
			hayQueResumir({
				credito: alDia,
				hitos: [{ fecha: "2026-09-10", descripcion: "x" }],
				gestiones: [],
			}),
		).toBe(true);
	});
});
