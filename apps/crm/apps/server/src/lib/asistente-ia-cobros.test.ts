import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
	armarContextoIA,
	asistenteActivo,
	exigirTitularPorIdentidad,
	generarUnaVez,
	hayQueResumir,
	huellaContexto,
	identidadesDelCaso,
	invalidarGeneracion,
	MODELO_ASISTENTE,
	nombresDeSolicitudes,
	palabrasDeNombres,
	taparDatosPersonales,
	taparNumeros,
	unirNombres,
	versionPrompt,
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
			taparDatosPersonales(
				"escribe a juan.perez@correo.com o al (502) 5555-1234",
			),
		).toBe("escribe a [correo] o al [número]");
		expect(taparDatosPersonales("DPI 2993.06216.0101")).toBe("DPI [número]");
	});
	test("tapa identificadores con diagonales y otros separadores", () => {
		expect(
			taparDatosPersonales("tel +502 5555/1234 o 5555_1234 o 5555–1234"),
		).toBe("tel [número] o [número] o [número]");
		expect(
			taparDatosPersonales("DPI 2993/06216/0101 y 2993\\06216\\0101"),
		).toBe("DPI [número] y [número]");
		expect(taparDatosPersonales("pagó Q1,500,000.00 el 3/10 y el 12/5")).toBe(
			"pagó Q1,500,000.00 el 3/10 y el 12/5",
		);
	});
	test("tapa los nombres sin importar mayúsculas ni acentos", () => {
		expect(
			taparDatosPersonales("Habló con MARIA jose, esposa de Perez", nombres),
		).toBe("Habló con [nombre] [nombre], esposa de [nombre]");
	});
	test("las palabras de cobranza se conservan en minúscula", () => {
		expect(taparDatosPersonales("tiene mora y pagó la cuota", nombres)).toBe(
			"tiene mora y pagó la cuota",
		);
	});
	test("pero si son apellido de alguien del caso, con mayúscula se tapan", () => {
		expect(palabrasDeNombres(["Juan Mora del Cid"])).toEqual(
			new Set(["juan", "mora", "del", "cid"]),
		);
		expect(
			taparDatosPersonales("Habló con Juan Mora, MORA no contesta", nombres),
		).toBe("Habló con [nombre] [nombre], [nombre] no contesta");
		expect(
			taparDatosPersonales(
				"Se llama San Pedro, vive San Juan",
				palabrasDeNombres(["Rosa San"]),
			),
		).toBe("Se llama [nombre] Pedro, vive [nombre] Juan");
	});
	test("los nombres cortos (Li, Wu) y las iniciales se tapan", () => {
		const n = palabrasDeNombres(["Li Wu", "Juan A. Pérez"]);
		expect(n).toEqual(new Set(["li", "wu", "juan", "a", "perez"]));
		expect(taparDatosPersonales("llamó li wu y Juan A. Pérez", n)).toBe(
			"llamó [nombre] [nombre] y [nombre] [nombre]. [nombre]",
		);
		expect(taparDatosPersonales("pagará a las 3 con Li", n)).toBe(
			"pagará a las 3 con [nombre]",
		);
	});
	test("no toca montos ni fechas con diagonal", () => {
		expect(taparDatosPersonales("pagará Q1,500.00 el 3/10", nombres)).toBe(
			"pagará Q1,500.00 el 3/10",
		);
	});
});

describe("unirNombres", () => {
	test("junta al titular con los demás", () => {
		expect(unirNombres(["Ana Gómez"], ["Luis Paz", null])).toEqual(
			new Set(["ana", "gomez", "luis", "paz"]),
		);
	});
	test("sin nombre del titular lanza, aunque haya referencias", () => {
		expect(() => unirNombres([null, "  "], ["Luis Paz"])).toThrow();
		expect(() => unirNombres([], [])).toThrow();
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
		expect(c.gestiones[0].comentario).toBe(
			"Habló con [nombre] [nombre], correo [correo]",
		);
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

describe("identidadesDelCaso", () => {
	const id = (leadId: string | null, opportunityId: string | null) => ({
		leadId,
		opportunityId,
	});
	test("suma las oportunidades que comparten el SIFCO, sin repetir", () => {
		expect(
			identidadesDelCaso(id("l1", "o1"), null, [
				id("l1", "o1"),
				id("l2", "o2"),
			]),
		).toEqual([id("l1", "o1"), id("l2", "o2")]);
	});
	test("incluye la del cliente del contrato aunque difiera de la resuelta", () => {
		expect(
			identidadesDelCaso(id("l2", "o2"), id("l1", "o1"), [id("l2", "o2")]),
		).toEqual([id("l2", "o2"), id("l1", "o1")]);
	});
	test("sin nada más queda la resuelta", () => {
		expect(identidadesDelCaso(id(null, null), null, [])).toEqual([
			id(null, null),
		]);
	});
});

describe("exigirTitularPorIdentidad", () => {
	test("pasa si todos los candidatos tienen nombre legible", () => {
		expect(() =>
			exigirTitularPorIdentidad([
				["Ana", "Gómez"],
				["Luis", null],
			]),
		).not.toThrow();
	});
	test("lanza si un candidato no tiene nombre aunque otro sí", () => {
		expect(() =>
			exigirTitularPorIdentidad([
				["Ana", "Gómez"],
				[null, "  "],
			]),
		).toThrow();
		expect(() => exigirTitularPorIdentidad([["Ana"], []])).toThrow();
	});
});

describe("versionPrompt", () => {
	test("es estable y entra en la huella del resumen", () => {
		expect(versionPrompt()).toMatch(/^[0-9a-f]{16}$/);
		expect(versionPrompt()).toBe(versionPrompt());
		const contexto = armarContextoIA(fuentes);
		const sinPrompt = createHash("sha256")
			.update(`${MODELO_ASISTENTE}\n${JSON.stringify(contexto)}`)
			.digest("hex");
		expect(huellaContexto(contexto)).not.toBe(sinPrompt);
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

describe("generarUnaVez", () => {
	const ctx = { credito: {}, hitos: [], gestiones: [] } as never;
	const resumen = (t: string) => ({ texto: t, etiquetas: [], generadoEn: "x" });
	const pausa = () => {
		let fin!: () => void;
		const p = new Promise<void>((r) => {
			fin = r;
		});
		return { p, fin };
	};

	test("misma huella en curso comparte la generación", async () => {
		const mapa = new Map();
		const gate = pausa();
		let llamadas = 0;
		const generar = async () => {
			llamadas++;
			await gate.p;
			return resumen("A");
		};
		const a = generarUnaVez("c1", ctx, "hA", generar, mapa);
		const b = generarUnaVez("c1", ctx, "hA", generar, mapa);
		gate.fin();
		expect(await a).toEqual(await b);
		expect(llamadas).toBe(1);
		expect(mapa.size).toBe(0);
	});

	test("huella nueva mientras se genera: espera y genera la nueva", async () => {
		const mapa = new Map();
		const gate = pausa();
		const huellas: string[] = [];
		const generar = async (_c: string, _x: unknown, h: string) => {
			huellas.push(h);
			if (h === "hA") await gate.p;
			return resumen(h);
		};
		const a = generarUnaVez("c1", ctx, "hA", generar, mapa);
		const b = generarUnaVez("c1", ctx, "hB", generar, mapa);
		gate.fin();
		expect((await a)?.texto).toBe("hA");
		expect((await b)?.texto).toBe("hB");
		expect(huellas).toEqual(["hA", "hB"]);
		expect(mapa.size).toBe(0);
	});

	test("la intermedia se salta si ya llegó una más nueva", async () => {
		const mapa = new Map();
		const gate = pausa();
		const huellas: string[] = [];
		const generar = async (_c: string, _x: unknown, h: string) => {
			huellas.push(h);
			if (h === "hA") await gate.p;
			return resumen(h);
		};
		const a = generarUnaVez("c1", ctx, "hA", generar, mapa);
		const b = generarUnaVez("c1", ctx, "hB", generar, mapa);
		const c = generarUnaVez("c1", ctx, "hC", generar, mapa);
		gate.fin();
		await a;
		expect(await b).toBeNull();
		expect((await c)?.texto).toBe("hC");
		expect(huellas).toEqual(["hA", "hC"]);
		expect(mapa.size).toBe(0);
	});

	test("una petición que leyó el contexto antes no reemplaza a la más nueva", async () => {
		const mapa = new Map();
		const gate = pausa();
		const guardadas: string[] = [];
		const generar = async (
			_c: string,
			_x: unknown,
			h: string,
			sigueVigente?: () => boolean,
		) => {
			await gate.p;
			if (sigueVigente && !sigueVigente()) return null;
			guardadas.push(h);
			return resumen(h);
		};
		// La nueva (leyó a las 10:00:02) llega primero; la vieja (10:00:01), después.
		const nueva = generarUnaVez(
			"c1",
			ctx,
			"hNueva",
			generar,
			mapa,
			"2026-10-09 10:00:02",
		);
		const vieja = generarUnaVez(
			"c1",
			ctx,
			"hVieja",
			generar,
			mapa,
			"2026-10-09 10:00:01",
		);
		gate.fin();
		expect((await nueva)?.texto).toBe("hNueva");
		expect((await vieja)?.texto).toBe("hNueva");
		expect(guardadas).toEqual(["hNueva"]);
		expect(mapa.size).toBe(0);
	});

	test("una petición que leyó el contexto después sí reemplaza a la anterior", async () => {
		const mapa = new Map();
		const gate = pausa();
		const huellas: string[] = [];
		const generar = async (_c: string, _x: unknown, h: string) => {
			huellas.push(h);
			if (h === "hA") await gate.p;
			return resumen(h);
		};
		const a = generarUnaVez(
			"c1",
			ctx,
			"hA",
			generar,
			mapa,
			"2026-10-09 10:00:01",
		);
		const b = generarUnaVez(
			"c1",
			ctx,
			"hB",
			generar,
			mapa,
			"2026-10-09 10:00:02",
		);
		gate.fin();
		expect((await a)?.texto).toBe("hA");
		expect((await b)?.texto).toBe("hB");
		expect(huellas).toEqual(["hA", "hB"]);
	});

	test("invalidar con una lectura más vieja no descarta la generación nueva", async () => {
		const mapa = new Map();
		const gate = pausa();
		const guardadas: string[] = [];
		const generar = async (
			_c: string,
			_x: unknown,
			h: string,
			sigueVigente?: () => boolean,
		) => {
			await gate.p;
			if (sigueVigente && !sigueVigente()) return null;
			guardadas.push(h);
			return resumen(h);
		};
		const a = generarUnaVez(
			"c1",
			ctx,
			"hA",
			generar,
			mapa,
			"2026-10-09 10:00:02",
		);
		// Una lectura de las 10:00:01 vio «nada que resumir»: ya hay algo más nuevo.
		invalidarGeneracion("c1", "2026-10-09 10:00:01", mapa);
		gate.fin();
		expect((await a)?.texto).toBe("hA");
		expect(guardadas).toEqual(["hA"]);
	});

	test("invalidar con una lectura más nueva sí la descarta", async () => {
		const mapa = new Map();
		const gate = pausa();
		const generar = async (
			_c: string,
			_x: unknown,
			_h: string,
			sigueVigente?: () => boolean,
		) => {
			await gate.p;
			return sigueVigente && !sigueVigente() ? null : resumen("hA");
		};
		const a = generarUnaVez(
			"c1",
			ctx,
			"hA",
			generar,
			mapa,
			"2026-10-09 10:00:01",
		);
		invalidarGeneracion("c1", "2026-10-09 10:00:02", mapa);
		gate.fin();
		expect(await a).toBeNull();
	});

	test("invalidar descarta la que va y la que espera turno", async () => {
		const mapa = new Map();
		const gate = pausa();
		const guardadas: string[] = [];
		const generar = async (
			_c: string,
			_x: unknown,
			h: string,
			sigueVigente?: () => boolean,
		) => {
			if (h === "hA") await gate.p;
			if (sigueVigente && !sigueVigente()) return null;
			guardadas.push(h);
			return resumen(h);
		};
		const a = generarUnaVez("c1", ctx, "hA", generar, mapa);
		const b = generarUnaVez("c1", ctx, "hB", generar, mapa);
		invalidarGeneracion("c1", undefined, mapa);
		gate.fin();
		expect(await a).toBeNull();
		expect(await b).toBeNull();
		expect(guardadas).toEqual([]);
		expect(mapa.size).toBe(0);
	});
});

describe("nombresDeSolicitudes", () => {
	const base = {
		segundoNombre: null,
		segundoApellido: null,
		apellidoCasada: null,
		conyuge: null,
	};
	test("la solicitud del titular alimenta al titular; el codeudor no", () => {
		const r = nombresDeSolicitudes([
			{
				...base,
				primerNombre: "Ana",
				primerApellido: "Gómez",
				personType: "lead",
			},
			{
				...base,
				primerNombre: "Luis",
				primerApellido: "Paz",
				personType: "coDebtor",
			},
		]);
		expect(r.titular).toContain("Ana");
		expect(r.titular).not.toContain("Luis");
		expect(r.otros).toContain("Luis");
	});
	test("una solicitud sin tipo cuenta como titular y evita el error de unirNombres", () => {
		const r = nombresDeSolicitudes([
			{
				...base,
				primerNombre: "Ana",
				primerApellido: "Gómez",
				personType: null,
			},
		]);
		expect(unirNombres(r.titular, r.otros).has("ana")).toBe(true);
	});
});
