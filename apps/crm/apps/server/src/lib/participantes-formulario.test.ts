import { describe, expect, test } from "bun:test";
import {
	armarParticipantes,
	claveDeFormulario,
	nombreDelFormulario,
	participantesDeLaAlerta,
	personasPropias,
} from "./participantes-formulario";

const OPP = "opp-1";
const titular = {
	id: "lead-1",
	firstName: "Ana",
	middleName: null,
	lastName: "López",
	secondLastName: "",
	email: "ana@t.test",
	phone: "55551234",
};
const codeudor = (id: string, fullName: string) => ({
	id,
	fullName,
	email: null,
	phone: null,
});
const fila = (extra: Record<string, unknown>) => ({
	personType: null,
	personId: null,
	opportunityId: OPP,
	...extra,
});

describe("claveDeFormulario y nombreDelFormulario", () => {
	test("la clave es tipo:id, o legacy:<oportunidad> sin dueño", () => {
		expect(claveDeFormulario(fila({ personType: "lead", personId: "x" }))).toBe(
			"lead:x",
		);
		expect(claveDeFormulario(fila({}))).toBe(`legacy:${OPP}`);
		expect(claveDeFormulario(fila({ personType: "lead" }))).toBe(
			`legacy:${OPP}`,
		);
	});
	test("el nombre sale de los cuatro campos del formulario, sin vacíos", () => {
		expect(
			nombreDelFormulario(
				fila({
					primerNombre: " Juan ",
					segundoNombre: "",
					primerApellido: "Pérez",
					segundoApellido: null,
				}),
			),
		).toBe("Juan Pérez");
		expect(nombreDelFormulario(null)).toBe("");
	});
});

describe("armarParticipantes", () => {
	const base = {
		opportunityId: OPP,
		lead: titular,
		coDebtors: [],
		tokens: [],
		creditRows: [],
		financialRows: [],
	};

	test("titular y codeudores numerados, con enlace permitido", () => {
		const p = armarParticipantes({
			...base,
			coDebtors: [codeudor("c1", "Carlos"), codeudor("c2", "Dora")],
		});
		expect([...p.keys()]).toEqual([
			"lead:lead-1",
			"coDebtor:c1",
			"coDebtor:c2",
		]);
		expect(p.get("lead:lead-1")).toMatchObject({
			displayName: "Ana López",
			roleLabel: "Titular",
			canGenerateLink: true,
		});
		expect(p.get("coDebtor:c2")).toMatchObject({
			displayName: "Dora",
			roleLabel: "Co-firmante 2",
		});
	});

	test("sin lead no hay titular", () => {
		expect(armarParticipantes({ ...base, lead: null }).size).toBe(0);
	});

	test("un codeudor borrado con enlace sale como «Co-firmante historico» con el nombre de su formulario", () => {
		const p = armarParticipantes({
			...base,
			tokens: [{ personType: "coDebtor", personId: "borrado" }],
			creditRows: [
				fila({
					personType: "coDebtor",
					personId: "borrado",
					primerNombre: "Beto",
					primerApellido: "Gómez",
					email: "b@t.test",
					telMovil: "44445678",
				}),
			],
		});
		expect(p.get("coDebtor:borrado")).toMatchObject({
			displayName: "Beto Gómez",
			roleLabel: "Co-firmante historico",
			email: "b@t.test",
			phone: "44445678",
			canGenerateLink: false,
		});
	});

	test("si no escribió su nombre, el nombre es la etiqueta histórica; el estado patrimonial sirve de respaldo", () => {
		const sinNombre = armarParticipantes({
			...base,
			tokens: [{ personType: "coDebtor", personId: "x" }],
		});
		expect(sinNombre.get("coDebtor:x")).toMatchObject({
			displayName: "Co-firmante historico",
		});
		const conPatrimonial = armarParticipantes({
			...base,
			tokens: [{ personType: "lead", personId: "viejo" }],
			financialRows: [
				fila({ personType: "lead", personId: "viejo", primerNombre: "Viejo" }),
			],
		});
		expect(conPatrimonial.get("lead:viejo")).toMatchObject({
			displayName: "Viejo",
			roleLabel: "Titular historico",
		});
	});

	test("si cambió el titular, el viejo es «Titular historico» con su nombre, no el del actual", () => {
		const p = armarParticipantes({
			...base,
			tokens: [{ personType: "lead", personId: "viejo" }],
			creditRows: [
				fila({
					personType: "lead",
					personId: "viejo",
					primerNombre: "Vicente",
				}),
			],
		});
		expect(p.get("lead:lead-1")?.displayName).toBe("Ana López");
		expect(p.get("lead:viejo")).toMatchObject({
			displayName: "Vicente",
			roleLabel: "Titular historico",
		});
	});

	test("un formulario sin dueño (legacy) aparece aunque no haya enlace; un enlace sin dueño también", () => {
		const porFormulario = armarParticipantes({
			...base,
			creditRows: [fila({ primerNombre: "Legado" })],
		});
		expect(porFormulario.get(`legacy:${OPP}`)).toMatchObject({
			personId: `legacy:${OPP}`,
			displayName: "Legado",
			roleLabel: "Titular legacy",
			canGenerateLink: false,
		});
		const porEnlace = armarParticipantes({
			...base,
			tokens: [{ personType: null, personId: null }],
		});
		expect(porEnlace.get(`legacy:${OPP}`)?.displayName).toBe("Titular legacy");
		expect(armarParticipantes(base).has(`legacy:${OPP}`)).toBe(false);
	});
});

describe("el nombre del formulario: la solicitud antes que el estado patrimonial", () => {
	const conLosDos = (personType: string | null, personId: string | null) => ({
		creditRows: [fila({ personType, personId, primerNombre: "DeLaSolicitud" })],
		financialRows: [
			fila({ personType, personId, primerNombre: "DelPatrimonial" }),
		],
	});

	test("histórico", () => {
		const p = armarParticipantes({
			opportunityId: OPP,
			lead: null,
			coDebtors: [],
			tokens: [{ personType: "coDebtor", personId: "x" }],
			...conLosDos("coDebtor", "x"),
		});
		expect(p.get("coDebtor:x")?.displayName).toBe("DeLaSolicitud");
	});

	test("formulario sin dueño", () => {
		const p = armarParticipantes({
			opportunityId: OPP,
			lead: null,
			coDebtors: [],
			tokens: [],
			...conLosDos(null, null),
		});
		expect(p.get(`legacy:${OPP}`)?.displayName).toBe("DeLaSolicitud");
	});
});

describe("participantesDeLaAlerta", () => {
	const base = {
		opportunityId: OPP,
		lead: titular,
		coDebtors: [codeudor("c1", "Carlos"), codeudor("c2", "Dora")],
		creditRows: [],
		financialRows: [],
	};

	test("quien dejó solicitud y ya no figura sale como histórico aunque no tenga enlace", () => {
		const p = participantesDeLaAlerta({
			...base,
			creditRows: [
				fila({
					personType: "coDebtor",
					personId: "borrado",
					primerNombre: "Sin Enlace",
				}),
				fila({ personType: "lead", personId: "viejo" }),
			],
		});
		expect(p.get("coDebtor:borrado")).toMatchObject({
			displayName: "Sin Enlace",
			roleLabel: "Co-firmante historico",
			canGenerateLink: false,
		});
		expect(p.get("lead:viejo")).toMatchObject({
			displayName: "Titular historico",
			roleLabel: "Titular historico",
		});
	});

	test("mismo orden que las tarjetas: titular, codeudores en su orden, históricos y sin dueño", () => {
		const p = participantesDeLaAlerta({
			...base,
			creditRows: [
				fila({ primerNombre: "Legado" }),
				fila({ personType: "coDebtor", personId: "borrado" }),
				fila({ personType: "coDebtor", personId: "c2" }),
				fila({ personType: "lead", personId: "lead-1" }),
			],
		});
		expect([...p.keys()]).toEqual([
			"lead:lead-1",
			"coDebtor:c1",
			"coDebtor:c2",
			"coDebtor:borrado",
			`legacy:${OPP}`,
		]);
		// los vigentes se nombran igual que en las tarjetas
		expect(p.get("lead:lead-1")?.displayName).toBe("Ana López");
		expect(p.get("coDebtor:c2")?.roleLabel).toBe("Co-firmante 2");
	});
});

describe("personasPropias", () => {
	test("titular, codeudores vigentes e históricos de solicitud, con sus leads y todos sus DPI", () => {
		const propias = personasPropias({
			opportunityId: OPP,
			lead: { ...titular, dpi: "DPI-LEAD" },
			coDebtors: [{ ...codeudor("c1", "Carlos"), dpi: "DPI-CODEUDOR" }],
			creditRows: [
				fila({
					personType: "lead",
					personId: "lead-1",
					dpi: "DPI-ESCRITO-TITULAR",
				}),
				fila({ personType: "coDebtor", personId: "c1", dpi: null }),
				fila({ personType: "lead", personId: "viejo", dpi: " DPI-HISTORICO " }),
				fila({
					personType: "coDebtor",
					personId: "borrado",
					dpi: "DPI-BORRADO",
				}),
				fila({ dpi: "DPI-LEGADO" }),
			],
		});
		expect(propias.leadIds.sort()).toEqual(["lead-1", "viejo"]);
		expect(propias.dpis.sort()).toEqual(
			[
				"DPI-BORRADO",
				"DPI-CODEUDOR",
				"DPI-ESCRITO-TITULAR",
				"DPI-HISTORICO",
				"DPI-LEAD",
				"DPI-LEGADO",
			].sort(),
		);
	});

	test("sin lead y con varias solicitudes sin dueño: cuenta el DPI de todas, en cualquier orden", () => {
		const a = fila({ dpi: "DPI-A" });
		const b = fila({ dpi: "DPI-B" });
		for (const creditRows of [
			[a, b],
			[b, a],
		]) {
			const propias = personasPropias({
				opportunityId: OPP,
				lead: null,
				coDebtors: [],
				creditRows,
			});
			expect(propias.dpis.sort()).toEqual(["DPI-A", "DPI-B"]);
		}
	});

	test("sin titular ni solicitudes: solo los codeudores; los DPI vacíos no cuentan", () => {
		expect(
			personasPropias({
				opportunityId: OPP,
				lead: null,
				coDebtors: [
					{ ...codeudor("c1", "Carlos"), dpi: "  " },
					{ ...codeudor("c2", "Dora"), dpi: "DPI-DORA" },
				],
				creditRows: [],
			}),
		).toEqual({ leadIds: [], dpis: ["DPI-DORA"] });
	});
});
