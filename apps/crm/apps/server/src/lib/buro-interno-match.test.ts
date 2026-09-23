import { describe, expect, test } from "bun:test";
import {
	type CandidatoBuroInterno,
	evaluarCoincidencias,
	normalizarTelefonoMatch,
	type RegistroParaMatch,
	resolverReglas,
	separarApellidos,
	similitud,
	validarParametrosRegla,
} from "./buro-interno-match";

const registroBase: RegistroParaMatch = {
	id: "reg-1",
	leadId: "lead-1",
	nombres: "Juan Carlos",
	apellidos: "Pérez Ixcot",
	dpi: "1234 56789 0101",
	nit: "1234567-8",
	telefono: "+502 5555-1234",
	direccion: "5a avenida 3-45 zona 1, Mixco",
};

const reglasPorDefecto = resolverReglas([]);

function reglasCon(
	clave: string,
	cambios: {
		activa?: boolean;
		severidad?: "alta" | "media" | "baja";
		parametros?: Record<string, unknown>;
	},
) {
	return resolverReglas([
		{
			clave,
			activa: cambios.activa ?? true,
			severidad: cambios.severidad ?? "media",
			parametros: cambios.parametros ?? {},
			orden: 0,
			updatedBy: null,
			updatedAt: new Date(),
		},
	]);
}

function titular(datos: Partial<CandidatoBuroInterno>): CandidatoBuroInterno {
	return { origen: "titular", etiqueta: "Titular", ...datos };
}

describe("normalización", () => {
	test("une partículas del apellido", () => {
		expect(separarApellidos("de León de la Cruz")).toEqual([
			"DE LEON",
			"DE LA CRUZ",
		]);
		expect(separarApellidos("PÉREZ  lópez")).toEqual(["PEREZ", "LOPEZ"]);
	});

	test("el teléfono se compara por los últimos 8 dígitos", () => {
		expect(normalizarTelefonoMatch("+502 5555-1234")).toBe("55551234");
		expect(normalizarTelefonoMatch("55551234")).toBe("55551234");
		expect(normalizarTelefonoMatch("1234")).toBeNull();
	});

	test("similitud", () => {
		expect(similitud("JUAN PEREZ", "JUAN PEREZ")).toBe(1);
		expect(
			similitud("JUAN CARLOS PEREZ IXCOT", "JUAN CARLOS PERES IXCOT"),
		).toBeGreaterThan(0.9);
	});
});

describe("identidad", () => {
	test("el mismo lead sigue saliendo aunque le cambien teléfono, DPI y nombre", () => {
		const [coincidencia] = evaluarCoincidencias(
			[
				titular({
					leadId: "lead-1",
					nombres: "Juanca",
					apellidos: "Ixcot",
					telefonos: ["4444 0000"],
				}),
			],
			[registroBase],
			reglasPorDefecto,
		);
		expect(coincidencia.severidad).toBe("alta");
		expect(coincidencia.reglas.map((r) => r.clave)).toEqual(["lead_igual"]);
	});

	test("el lead solo se compara en el titular", () => {
		const coincidencias = evaluarCoincidencias(
			[
				{
					origen: "codeudor",
					etiqueta: "Codeudor",
					leadId: "lead-1",
					nombreCompleto: "Otro Nombre",
				},
			],
			[registroBase],
			reglasPorDefecto,
		);
		expect(coincidencias).toEqual([]);
	});

	test("mismo DPI con otro nombre es la misma persona y calla las reglas de familia", () => {
		const [coincidencia] = evaluarCoincidencias(
			[
				titular({
					nombres: "Juan",
					apellidos: "Pérez Ixcot",
					dpi: "1234567890101",
				}),
			],
			[registroBase],
			reglasPorDefecto,
		);

		expect(coincidencia.severidad).toBe("alta");
		const claves = coincidencia.reglas.map((r) => r.clave);
		expect(claves).toContain("dpi_igual");
		expect(claves).not.toContain("mismos_apellidos");
	});

	test("mismo nombre completo sin importar tildes ni orden", () => {
		const [coincidencia] = evaluarCoincidencias(
			[titular({ nombreCompleto: "PEREZ IXCOT JUAN CARLOS" })],
			[registroBase],
			reglasPorDefecto,
		);
		expect(coincidencia.reglas.map((r) => r.clave)).toEqual([
			"nombre_completo_igual",
		]);
	});

	test("apellidos juntos en un solo campo (last_name con los dos)", () => {
		const [coincidencia] = evaluarCoincidencias(
			[titular({ nombres: "Juan Carlos", apellidos: "PEREZ IXCOT" })],
			[registroBase],
			reglasPorDefecto,
		);
		expect(coincidencia.reglas.map((r) => r.clave)).toContain(
			"nombre_completo_igual",
		);
	});

	test("NIT CF no identifica a nadie", () => {
		const coincidencias = evaluarCoincidencias(
			[titular({ nombres: "Ana", apellidos: "Soto", nit: "CF" })],
			[{ ...registroBase, nit: "C/F" }],
			reglasPorDefecto,
		);
		expect(coincidencias).toEqual([]);
	});

	test("un nombre de dos palabras no alcanza para decir que es la misma persona", () => {
		const coincidencias = evaluarCoincidencias(
			[titular({ nombres: "Juan", apellidos: "Pérez" })],
			[{ ...registroBase, nombres: "Juan", apellidos: "Pérez" }],
			reglasPorDefecto,
		);
		expect(coincidencias).toEqual([]);
	});
});

describe("familia", () => {
	test("la hermana: mismos dos apellidos", () => {
		const [coincidencia] = evaluarCoincidencias(
			[titular({ nombres: "María José", apellidos: "Pérez Ixcot" })],
			[registroBase],
			reglasPorDefecto,
		);
		expect(coincidencia.severidad).toBe("media");
		expect(coincidencia.reglas.map((r) => r.clave)).toEqual([
			"mismos_apellidos",
		]);
	});

	test("apellido en común y la misma dirección", () => {
		const [coincidencia] = evaluarCoincidencias(
			[
				titular({
					nombres: "Rosa",
					apellidos: "Ixcot Tuy",
					direccion: "5a Avenida 3-45, Zona 1 Mixco",
				}),
			],
			[registroBase],
			reglasPorDefecto,
		);
		expect(coincidencia.reglas.map((r) => r.clave)).toEqual([
			"apellido_y_direccion",
		]);
	});

	test("un apellido en común está apagada por defecto", () => {
		const coincidencias = evaluarCoincidencias(
			[titular({ nombres: "Pedro", apellidos: "Ixcot Tuy" })],
			[registroBase],
			reglasPorDefecto,
		);
		expect(coincidencias).toEqual([]);
	});

	test("encendida, ignora los apellidos comunes", () => {
		const reglas = reglasCon("apellido_en_comun", {
			activa: true,
			severidad: "baja",
		});

		const conApellidoRaro = evaluarCoincidencias(
			[titular({ nombres: "Pedro", apellidos: "Ixcot Tuy" })],
			[registroBase],
			reglas,
		);
		expect(conApellidoRaro[0].reglas.map((r) => r.clave)).toEqual([
			"apellido_en_comun",
		]);

		const conApellidoComun = evaluarCoincidencias(
			[titular({ nombres: "Pedro", apellidos: "Pérez Tuy" })],
			[registroBase],
			reglas,
		);
		expect(conApellidoComun).toEqual([]);
	});
});

describe("campos sueltos en la consulta", () => {
	const registroIxcot: RegistroParaMatch = {
		...registroBase,
		leadId: null,
		dpi: null,
		nit: null,
		telefono: null,
		nombres: "Rosa",
		apellidos: "Ixcot Tuy",
	};
	const direccion = "5a Avenida 3-45, Zona 1 Mixco";

	test("solo apellidos: no se parten en nombre + apellido", () => {
		const [coincidencia] = evaluarCoincidencias(
			[titular({ apellidos: "Ixcot Pérez", direccion })],
			[registroIxcot],
			reglasPorDefecto,
		);
		expect(coincidencia.reglas.map((r) => r.clave)).toEqual([
			"apellido_y_direccion",
		]);
	});

	test("solo nombres: un nombre no se vuelve apellido", () => {
		const coincidencias = evaluarCoincidencias(
			[titular({ nombres: "Juan Tuy", direccion })],
			[registroIxcot],
			reglasPorDefecto,
		);
		expect(coincidencias).toEqual([]);
	});
});

describe("contacto y alcance", () => {
	test("la referencia de la solicitud es el moroso (mismo teléfono)", () => {
		const [coincidencia] = evaluarCoincidencias(
			[
				{
					origen: "referencia",
					etiqueta: "Referencia: Juanca",
					nombreCompleto: "Juanca",
					telefonos: ["5555 1234"],
				},
			],
			[registroBase],
			reglasPorDefecto,
		);
		expect(coincidencia.origen).toBe("referencia");
		expect(coincidencia.reglas.map((r) => r.clave)).toEqual(["telefono_igual"]);
	});

	test("las reglas de apellidos no se aplican a referencias por defecto", () => {
		const coincidencias = evaluarCoincidencias(
			[
				{
					origen: "referencia",
					etiqueta: "Referencia",
					nombreCompleto: "María José Pérez Ixcot",
				},
			],
			[registroBase],
			reglasPorDefecto,
		);
		expect(coincidencias).toEqual([]);
	});

	test("una regla apagada no dispara", () => {
		const coincidencias = evaluarCoincidencias(
			[titular({ nombres: "Otro", apellidos: "Nombre", dpi: "1234567890101" })],
			[registroBase],
			reglasCon("dpi_igual", { activa: false }),
		);
		expect(coincidencias).toEqual([]);
	});

	test("el umbral de parecido se puede subir", () => {
		const candidato = titular({
			nombres: "Juan Carlos",
			apellidos: "Peres Ixcot",
		});

		const conDefecto = evaluarCoincidencias(
			[candidato],
			[registroBase],
			reglasPorDefecto,
		);
		expect(conDefecto[0].reglas.map((r) => r.clave)).toContain(
			"nombre_similar",
		);

		const estricto = evaluarCoincidencias(
			[candidato],
			[registroBase],
			reglasCon("nombre_similar", { parametros: { umbral: 0.99 } }),
		);
		expect(estricto.flatMap((c) => c.reglas.map((r) => r.clave))).not.toContain(
			"nombre_similar",
		);
	});
});

describe("validarParametrosRegla", () => {
	test("rechaza umbral fuera de rango y claves de otra regla", () => {
		expect(validarParametrosRegla("nombre_similar", { umbral: 0.2 }).ok).toBe(
			false,
		);
		expect(validarParametrosRegla("no_existe", {}).ok).toBe(false);

		const resultado = validarParametrosRegla("dpi_igual", {
			aplica_a: ["titular"],
			umbral: 0.9,
		});
		expect(resultado).toEqual({
			ok: true,
			parametros: { aplica_a: ["titular"] },
		});
	});

	test("normaliza la lista de apellidos ignorados", () => {
		const resultado = validarParametrosRegla("apellido_en_comun", {
			apellidos_ignorados: ["López", "lopez", " García "],
		});
		expect(resultado).toEqual({
			ok: true,
			parametros: { apellidos_ignorados: ["LOPEZ", "GARCIA"] },
		});
	});
});
