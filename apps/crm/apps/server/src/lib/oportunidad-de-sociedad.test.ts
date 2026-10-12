import { describe, expect, test } from "bun:test";
import {
	codeudoresDeMas,
	esOportunidadDeSociedad,
	faltantesDelRepresentante,
	motivoParaNoGenerar,
	motivoPorRepresentanteCambiado,
	nombreDeLaSociedad,
	representanteLegalDe,
} from "./oportunidad-de-sociedad";

const codeudor = (id: string, esRepresentanteLegal = false) => ({
	id,
	esRepresentanteLegal,
});

describe("oportunidad de sociedad", () => {
	test("empresa sin marca y un solo codeudor: ése es el representante", () => {
		const datos = { clientType: "empresa", coDeudores: [codeudor("a")] };
		expect(esOportunidadDeSociedad(datos)).toBe(true);
		expect(representanteLegalDe(datos)?.id).toBe("a");
		expect(codeudoresDeMas(datos)).toEqual([]);
	});

	test("lead individual con un codeudor marcado: también es de sociedad", () => {
		const datos = {
			clientType: "individual",
			coDeudores: [codeudor("a"), codeudor("b", true)],
		};
		expect(esOportunidadDeSociedad(datos)).toBe(true);
		expect(representanteLegalDe(datos)?.id).toBe("b");
		expect(codeudoresDeMas(datos).map((cd) => cd.id)).toEqual(["a"]);
	});

	test("empresa con dos codeudores sin marcar: no se adivina el representante", () => {
		const datos = {
			clientType: "empresa",
			coDeudores: [codeudor("a"), codeudor("b")],
		};
		expect(esOportunidadDeSociedad(datos)).toBe(true);
		expect(representanteLegalDe(datos)).toBeNull();
		expect(codeudoresDeMas(datos).map((cd) => cd.id)).toEqual(["a", "b"]);
	});

	test("empresa con varios codeudores: firma el marcado, los demás sobran", () => {
		const datos = {
			clientType: "empresa",
			coDeudores: [codeudor("a"), codeudor("b", true), codeudor("c")],
		};
		expect(representanteLegalDe(datos)?.id).toBe("b");
		expect(codeudoresDeMas(datos).map((cd) => cd.id)).toEqual(["a", "c"]);
	});

	test("empresa sin codeudores: es de sociedad pero falta el representante", () => {
		const datos = { clientType: "empresa", coDeudores: [] };
		expect(esOportunidadDeSociedad(datos)).toBe(true);
		expect(representanteLegalDe(datos)).toBeNull();
	});

	test("lead individual sin marca: no es de sociedad y no sobra nadie", () => {
		const datos = {
			clientType: "individual",
			coDeudores: [codeudor("a")],
		};
		expect(esOportunidadDeSociedad(datos)).toBe(false);
		expect(representanteLegalDe(datos)).toBeNull();
		expect(codeudoresDeMas(datos)).toEqual([]);
	});
});

describe("qué batería se puede generar", () => {
	const persona = { clientType: "individual", coDeudores: [codeudor("a")] };
	const sociedad = { clientType: "empresa", coDeudores: [codeudor("a", true)] };

	test("una persona lleva los individuales, no los de sociedad", () => {
		expect(
			motivoParaNoGenerar(persona, [
				"garantia_mobiliaria",
				"declaracion_vendedor",
			]),
		).toBeNull();
		expect(
			motivoParaNoGenerar(persona, ["garantia_mobiliaria_sociedad"]),
		).toContain("no es de una sociedad");
	});

	test("una sociedad lleva los de sociedad y la declaración del vendedor", () => {
		expect(
			motivoParaNoGenerar(sociedad, [
				"garantia_mobiliaria_sociedad",
				"declaracion_vendedor",
			]),
		).toBeNull();
		expect(motivoParaNoGenerar(sociedad, ["garantia_mobiliaria"])).toContain(
			"no los individuales",
		);
	});

	test("sin representante o con codeudores de más no se genera", () => {
		const sinMarca = {
			clientType: "empresa",
			coDeudores: [codeudor("a"), codeudor("b")],
		};
		expect(
			motivoParaNoGenerar(sinMarca, ["garantia_mobiliaria_sociedad"]),
		).toContain("representante legal");
		const conDeMas = {
			clientType: "empresa",
			coDeudores: [codeudor("a", true), codeudor("b")],
		};
		expect(
			motivoParaNoGenerar(conDeMas, ["garantia_mobiliaria_sociedad"]),
		).toContain("un co-firmante de más");
	});

	test("el nombre de la sociedad sale del lead, en mayúsculas", () => {
		expect(
			nombreDeLaSociedad(["Grupo ", "de ", "Negocios STS", "S.A", null]),
		).toBe("GRUPO DE NEGOCIOS STS S.A");
	});
});

describe("regenerar con el representante de la última generación", () => {
	const representante = { dpi: "2999999980101", email: "rep@prueba.test" };

	test("mismo DPI, aunque venga con espacios, y mismo correo: se puede", () => {
		expect(
			motivoPorRepresentanteCambiado(representante, {
				dpi: "2999 99998 0101",
				email: "REP@prueba.test",
			}),
		).toBeNull();
	});

	test("mismo DPI pero le corrigieron el correo: hay que generar de nuevo", () => {
		expect(
			motivoPorRepresentanteCambiado(representante, {
				dpi: "2999999980101",
				email: "viejo@prueba.test",
			}),
		).toContain("cambió");
	});

	test("otro DPI: hay que generar de nuevo", () => {
		expect(
			motivoPorRepresentanteCambiado(representante, {
				dpi: "1111111110101",
				email: "rep@prueba.test",
			}),
		).toContain("cambió");
	});

	test("foto sin DPI: se compara el correo", () => {
		expect(
			motivoPorRepresentanteCambiado(representante, {
				email: "REP@prueba.test",
			}),
		).toBeNull();
		expect(
			motivoPorRepresentanteCambiado(representante, { email: "x@prueba.test" }),
		).toContain("cambió");
	});
});

describe("lo que le falta al representante", () => {
	const rep = (cambios: Partial<Record<string, unknown>> = {}) => ({
		id: "a",
		esRepresentanteLegal: true,
		dpi: "2999999980101",
		email: "rep@prueba.test",
		phone: "50255555555",
		gender: "female",
		age: 41,
		maritalStatus: "married",
		...cambios,
	});

	test("una persona: no aplica", () => {
		expect(
			faltantesDelRepresentante({
				clientType: "individual",
				coDeudores: [rep({ esRepresentanteLegal: false, phone: null })],
			}),
		).toEqual([]);
	});

	test("una sociedad completa no pide nada", () => {
		expect(
			faltantesDelRepresentante({ clientType: "empresa", coDeudores: [rep()] }),
		).toEqual([]);
	});

	test("sin representante, sin celular o con codeudores de más", () => {
		expect(
			faltantesDelRepresentante({ clientType: "empresa", coDeudores: [] }),
		).toEqual(["Marcar al representante legal en los co-firmantes"]);
		expect(
			faltantesDelRepresentante({
				clientType: "empresa",
				coDeudores: [rep({ phone: " ", age: null })],
			}),
		).toEqual(["Teléfono", "Edad"]);
		expect(
			faltantesDelRepresentante({
				clientType: "empresa",
				coDeudores: [rep(), rep({ id: "b", esRepresentanteLegal: false })],
			}),
		).toEqual([
			"Quitar el co-firmante de más: los contratos de sociedad sólo los firma el representante",
		]);
	});
});
