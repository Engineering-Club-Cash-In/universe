import { describe, expect, it } from "bun:test";
import {
	agregarATelefonosDelCaso,
	claveReferencia,
	claveTelefono,
	construirReferencias,
	type EntradaReferencias,
	encontrarReferencia,
	leerFilasReferenciasJson,
	referenciaDelTelefono,
	referenciaTieneTelefono,
	separarTelefonos,
} from "./referencias-cobros";

function entrada(
	parcial: Partial<EntradaReferencias> = {},
): EntradaReferencias {
	return {
		referenciasLead: [],
		solicitudesTitular: [],
		codeudores: [],
		telefonosAgregados: [],
		contactos: [],
		...parcial,
	};
}

function solicitud(
	parcial: Partial<EntradaReferencias["solicitudesTitular"][number]> = {},
): EntradaReferencias["solicitudesTitular"][number] {
	return {
		id: "sol-1",
		referenciasPersonales: null,
		referenciasCrediticias: null,
		conyugeNombre: null,
		conyugeEmpresa: null,
		conyugeTelMovil: null,
		conyugeTelOficina: null,
		telEmergencia: null,
		...parcial,
	};
}

describe("separarTelefonos / claveTelefono", () => {
	it("separa por coma, barra y punto y coma, y descarta lo que no trae dígitos", () => {
		expect(separarTelefonos("5844-6376, 2221 5273 / 4444 4444; n/a")).toEqual([
			"5844-6376",
			"2221 5273",
			"4444 4444",
		]);
		expect(separarTelefonos(null)).toEqual([]);
	});

	it("compara por los 8 dígitos guatemaltecos, con o sin 502", () => {
		expect(claveTelefono("+502 5844-6376")).toBe("58446376");
		expect(claveTelefono("5844 6376")).toBe("58446376");
		// Un fijo viejo de 7 dígitos no normaliza, pero se compara crudo.
		expect(claveTelefono("222-1527")).toBe("2221527");
		expect(claveTelefono("12")).toBeNull();
	});
});

describe("leerFilasReferenciasJson", () => {
	it("descarta las filas vacías del formulario y conserva la posición original", () => {
		const filas = leerFilasReferenciasJson([
			{ nombre: "", relacion: "", telefono: "" },
			{ nombre: " Ana ", relacion: "amiga", telefono: "5555 5555" },
			{ nombre: "Beto", telefono: "" },
		]);
		expect(filas).toEqual([
			{ indice: 1, nombre: "Ana", relacion: "amiga", telefono: "5555 5555" },
			{ indice: 2, nombre: "Beto", relacion: "", telefono: "" },
		]);
	});

	it("tolera basura: null, objeto suelto, elementos que no son objetos", () => {
		expect(leerFilasReferenciasJson(null)).toEqual([]);
		expect(leerFilasReferenciasJson({ nombre: "x" })).toEqual([]);
		expect(leerFilasReferenciasJson(["texto", 3, null])).toEqual([]);
	});
});

describe("construirReferencias", () => {
	it("arma las seis fuentes con su origen y en orden de prioridad", () => {
		const refs = construirReferencias(
			entrada({
				referenciasLead: [
					{
						id: "rl-1",
						nombre: "María López",
						telefono: "30000001",
						parentesco: "hermano_a",
						notas: "Vive en zona 5",
					},
				],
				codeudores: [
					{ id: "cd-1", fullName: "Pedro Cofirmante", phone: "30000002" },
				],
				solicitudesTitular: [
					solicitud({
						conyugeNombre: "Lucía",
						conyugeEmpresa: "Banco X",
						conyugeTelMovil: "30000003",
						conyugeTelOficina: "22000003",
						referenciasPersonales: [
							{ nombre: "Juan", relacion: "amigo", telefono: "30000004" },
						],
						referenciasCrediticias: [
							{ nombre: "Tía Rosa", telefono: "30000005" },
						],
						telEmergencia: "30000006",
					}),
				],
			}),
		);

		expect(refs.map((r) => r.origen)).toEqual([
			"cobros",
			"cofirmante",
			"conyuge",
			"ventas_personal",
			"ventas_familiar",
			"emergencia",
		]);
		expect(refs.map((r) => r.key)).toEqual([
			claveReferencia.cobros("rl-1"),
			claveReferencia.cofirmante("cd-1"),
			claveReferencia.conyuge("sol-1"),
			claveReferencia.ventasPersonal("sol-1", 0),
			claveReferencia.ventasFamiliar("sol-1", 0),
			claveReferencia.emergencia("sol-1"),
		]);

		const [cobros, , conyuge, personal] = refs;
		expect(cobros?.editable).toEqual({
			referenciaLeadId: "rl-1",
			parentesco: "hermano_a",
			telefono: "30000001",
			notas: "Vive en zona 5",
		});
		expect(conyuge?.detalle).toBe("Trabaja en Banco X");
		expect(conyuge?.telefonos.map((t) => [t.telefono, t.etiqueta])).toEqual([
			["30000003", "Móvil"],
			["22000003", "Oficina"],
		]);
		expect(personal?.detalle).toBe("amigo");
		// Solo lo de cobros se edita.
		expect(refs.filter((r) => r.editable).length).toBe(1);
	});

	it("una referencia de ventas sin número igual aparece, para poder completarla", () => {
		const refs = construirReferencias(
			entrada({
				solicitudesTitular: [
					solicitud({
						referenciasPersonales: [
							{ nombre: "Sin Teléfono", relacion: "vecino" },
						],
					}),
				],
				codeudores: [
					{ id: "cd-1", fullName: "Cofirmante Sin Tel", phone: null },
				],
			}),
		);
		expect(refs.map((r) => [r.nombre, r.telefonos.length])).toEqual([
			["Cofirmante Sin Tel", 0],
			["Sin Teléfono", 0],
		]);
	});

	it("el contacto de emergencia sin número no aparece (no trae nombre)", () => {
		const refs = construirReferencias(
			entrada({ solicitudesTitular: [solicitud({ telEmergencia: "  " })] }),
		);
		expect(refs).toEqual([]);
	});

	it("el mismo teléfono en dos fuentes es la misma persona: una fila con las dos etiquetas", () => {
		const refs = construirReferencias(
			entrada({
				codeudores: [
					{ id: "cd-1", fullName: "Pedro Pérez", phone: "5844-6376" },
				],
				solicitudesTitular: [
					solicitud({
						referenciasPersonales: [
							{
								nombre: "Pedro P.",
								relacion: "amigo",
								telefono: "+502 58446376",
							},
						],
						telEmergencia: "58446376",
					}),
				],
			}),
		);
		expect(refs).toHaveLength(1);
		const [pedro] = refs;
		expect(pedro?.origen).toBe("cofirmante");
		expect(pedro?.origenes).toEqual([
			"cofirmante",
			"ventas_personal",
			"emergencia",
		]);
		expect(pedro?.keys).toEqual([
			claveReferencia.cofirmante("cd-1"),
			claveReferencia.ventasPersonal("sol-1", 0),
			claveReferencia.emergencia("sol-1"),
		]);
		// El número sale una sola vez aunque venga escrito distinto.
		expect(pedro?.telefonos.map((t) => t.telefono)).toEqual(["5844-6376"]);
		// "Contacto de emergencia" es relleno, no otro nombre de la persona.
		expect(pedro?.otrosNombres).toEqual(["Pedro P."]);
		expect(pedro?.detalle).toBe("amigo");
	});

	it("dos referencias de cobros con el mismo número NO se juntan (cada una se edita aparte)", () => {
		const refs = construirReferencias(
			entrada({
				referenciasLead: [
					{
						id: "rl-1",
						nombre: "A",
						telefono: "30000001",
						parentesco: "otro",
						notas: null,
					},
					{
						id: "rl-2",
						nombre: "B",
						telefono: "30000001",
						parentesco: "otro",
						notas: null,
					},
				],
			}),
		);
		expect(refs.map((r) => r.key)).toEqual([
			claveReferencia.cobros("rl-1"),
			claveReferencia.cobros("rl-2"),
		]);
	});

	it("los teléfonos que agregó cobros se suman a la fila y también la agrupan", () => {
		const creado = new Date("2026-09-25T15:00:00.000Z");
		const refs = construirReferencias(
			entrada({
				codeudores: [{ id: "cd-1", fullName: "Pedro", phone: null }],
				solicitudesTitular: [
					solicitud({
						referenciasPersonales: [
							{ nombre: "Pedro", relacion: "", telefono: "30000009" },
						],
					}),
				],
				telefonosAgregados: [
					{
						id: "tel-1",
						referenciaKey: claveReferencia.cofirmante("cd-1"),
						telefono: "30000009",
						notas: "Lo dio la mamá",
						registradoPor: "Asesor Uno",
						createdAt: creado,
					},
				],
			}),
		);
		expect(refs).toHaveLength(1);
		const [pedro] = refs;
		expect(pedro?.origenes).toEqual(["cofirmante", "ventas_personal"]);
		// El número sale una vez, como original de ventas, y el agregado NO se
		// esconde: queda colgado de esa entrada para poder quitarlo (Codex,
		// PR #1751).
		expect(pedro?.telefonos).toEqual([
			{
				telefono: "30000009",
				etiqueta: null,
				original: true,
				agregados: [
					{
						id: "tel-1",
						referenciaKey: claveReferencia.cofirmante("cd-1"),
						notas: "Lo dio la mamá",
						registradoPor: "Asesor Uno",
						createdAt: creado,
					},
				],
			},
		]);
	});

	it("una referencia de cobros creada después con el número de un agregado no lo esconde", () => {
		const creado = new Date("2026-09-25T15:00:00.000Z");
		const [ref] = construirReferencias(
			entrada({
				referenciasLead: [
					{
						id: "rl-1",
						nombre: "Mildred",
						telefono: "3321-7788",
						parentesco: "amigo_a",
						notas: null,
					},
				],
				solicitudesTitular: [
					solicitud({
						referenciasPersonales: [
							{ nombre: "Mildred G.", relacion: "amiga", telefono: "48279589" },
						],
					}),
				],
				telefonosAgregados: [
					{
						id: "tel-1",
						referenciaKey: claveReferencia.ventasPersonal("sol-1", 0),
						telefono: "33217788",
						notas: null,
						registradoPor: "Asesor Uno",
						createdAt: creado,
					},
				],
			}),
		);
		// Se juntaron por el número; la de cobros encabeza.
		expect(ref?.origenes).toEqual(["cobros", "ventas_personal"]);
		const telefono = ref?.telefonos.find((t) => t.telefono === "3321-7788");
		expect(telefono?.original).toBe(true);
		expect(telefono?.agregados.map((a) => a.id)).toEqual(["tel-1"]);
	});

	it("un teléfono agregado nuevo aparece marcado como agregado", () => {
		const creado = new Date("2026-09-25T15:00:00.000Z");
		const [ref] = construirReferencias(
			entrada({
				codeudores: [{ id: "cd-1", fullName: "Pedro", phone: null }],
				telefonosAgregados: [
					{
						id: "tel-1",
						referenciaKey: claveReferencia.cofirmante("cd-1"),
						telefono: "30000009",
						notas: null,
						registradoPor: "Asesor Uno",
						createdAt: creado,
					},
				],
			}),
		);
		expect(ref?.telefonos).toEqual([
			{
				telefono: "30000009",
				etiqueta: null,
				original: false,
				agregados: [
					{
						id: "tel-1",
						referenciaKey: claveReferencia.cofirmante("cd-1"),
						notas: null,
						registradoPor: "Asesor Uno",
						createdAt: creado,
					},
				],
			},
		]);
	});

	it("el último intento sale de cualquier llave de la fila, el más reciente", () => {
		const refs = construirReferencias(
			entrada({
				codeudores: [{ id: "cd-1", fullName: "Pedro", phone: "30000009" }],
				solicitudesTitular: [
					solicitud({
						referenciasPersonales: [
							{ nombre: "Pedro", relacion: "", telefono: "30000009" },
						],
					}),
				],
				contactos: [
					{
						referenciaKey: claveReferencia.cofirmante("cd-1"),
						fechaContacto: new Date("2026-09-20T10:00:00.000Z"),
						metodoContacto: "llamada",
						resultado: "no_contesta",
						realizadoPor: "Asesor Uno",
					},
					{
						referenciaKey: claveReferencia.ventasPersonal("sol-1", 0),
						fechaContacto: new Date("2026-09-24T10:00:00.000Z"),
						metodoContacto: "llamada",
						resultado: "dio_informacion",
						realizadoPor: "Asesor Dos",
					},
					{
						referenciaKey: "cobros:otra-que-ya-no-existe",
						fechaContacto: new Date("2026-09-25T10:00:00.000Z"),
						metodoContacto: "llamada",
						resultado: "no_contesta",
						realizadoPor: "Asesor Dos",
					},
				],
			}),
		);
		expect(refs).toHaveLength(1);
		expect(refs[0]?.totalContactos).toBe(2);
		expect(refs[0]?.ultimoContacto?.resultado).toBe("dio_informacion");
	});
});

describe("referenciaDelTelefono", () => {
	const refs = construirReferencias(
		entrada({
			codeudores: [{ id: "cd-1", fullName: "Pedro", phone: "5844-6376" }],
			solicitudesTitular: [
				solicitud({
					referenciasPersonales: [
						{ nombre: "Ana", relacion: "", telefono: "" },
					],
				}),
			],
		}),
	);

	it("encuentra a la OTRA referencia dueña del número, para rechazar el agregado", () => {
		expect(referenciaDelTelefono(refs, "+502 58446376")?.key).toBe(
			claveReferencia.cofirmante("cd-1"),
		);
		expect(referenciaDelTelefono(refs, "30000000")).toBeNull();
	});
});

describe("encontrarReferencia / referenciaTieneTelefono", () => {
	const refs = construirReferencias(
		entrada({
			codeudores: [{ id: "cd-1", fullName: "Pedro", phone: "5844-6376" }],
			solicitudesTitular: [
				solicitud({
					referenciasPersonales: [
						{ nombre: "Pedro", relacion: "", telefono: "58446376" },
					],
				}),
			],
		}),
	);

	it("encuentra la fila por cualquiera de sus llaves", () => {
		expect(
			encontrarReferencia(refs, claveReferencia.ventasPersonal("sol-1", 0))
				?.key,
		).toBe(claveReferencia.cofirmante("cd-1"));
		expect(encontrarReferencia(refs, "cofirmante:inventada")).toBeNull();
	});

	it("compara el teléfono por dígitos", () => {
		const [pedro] = refs;
		if (!pedro) throw new Error("falta la referencia");
		expect(referenciaTieneTelefono(pedro, "+502 5844 6376")).toBe(true);
		expect(referenciaTieneTelefono(pedro, "30000000")).toBe(false);
	});
});

describe("agregarATelefonosDelCaso", () => {
	it("lo suma al alternativo separado por coma", () => {
		expect(agregarATelefonosDelCaso("58446376", null, "3000-0009")).toBe(
			"3000-0009",
		);
		expect(agregarATelefonosDelCaso("58446376", "22215273", "30000009")).toBe(
			"22215273, 30000009",
		);
	});

	it("no lo repite si ya está en el principal o en el alternativo (por dígitos)", () => {
		expect(
			agregarATelefonosDelCaso("5844-6376, 22215273", null, "+502 58446376"),
		).toBeNull();
		expect(
			agregarATelefonosDelCaso("11111111", "3000 0009", "30000009"),
		).toBeNull();
	});
});
