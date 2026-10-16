import { describe, expect, test } from "bun:test";
import {
	armarParticipantes,
	claveDeFormulario,
	nombreDelFormulario,
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
