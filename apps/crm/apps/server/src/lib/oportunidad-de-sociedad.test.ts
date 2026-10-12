import { describe, expect, test } from "bun:test";
import {
	codeudoresDeMas,
	esOportunidadDeSociedad,
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
