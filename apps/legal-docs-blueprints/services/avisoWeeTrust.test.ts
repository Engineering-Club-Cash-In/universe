import { describe, expect, test } from "bun:test";
import { leerAvisoDeWeeTrust } from "./avisoWeeTrust";

describe("leerAvisoDeWeeTrust", () => {
	test("lee el documento dentro de `Document`, como lo manda WeeTrust", () => {
		const aviso = leerAvisoDeWeeTrust({
			type: "signDocument",
			Document: { _id: "65df50c0d7c299002a067f28", documentID: "65df50c0d7c299002a067f28", status: "PENDING" },
			addedOn: 1709135576037,
		});
		expect(aviso.tipo).toBe("signDocument");
		expect(aviso.documentID).toBe("65df50c0d7c299002a067f28");
	});

	test("acepta el cuerpo como texto", () => {
		const aviso = leerAvisoDeWeeTrust(
			JSON.stringify({ type: "completedDocument", Document: { documentID: "abc" } }),
		);
		expect(aviso.tipo).toBe("completedDocument");
		expect(aviso.documentID).toBe("abc");
	});

	test("sigue aceptando las formas que se usaban en las pruebas", () => {
		expect(leerAvisoDeWeeTrust({ type: "signDocument", documentID: "a1" }).documentID).toBe("a1");
		expect(
			leerAvisoDeWeeTrust({ event: "signDocument", document: { documentID: "b2" } }),
		).toMatchObject({ tipo: "signDocument", documentID: "b2" });
	});

	test("sin documento devuelve las claves para el log, no los valores", () => {
		const aviso = leerAvisoDeWeeTrust({ type: "x", otra: "secreto" });
		expect(aviso.documentID).toBeUndefined();
		expect(aviso.claves).toEqual(["type", "otra"]);
	});

	test("un cuerpo que no es JSON no rompe", () => {
		expect(leerAvisoDeWeeTrust("no es json")).toMatchObject({
			tipo: "unknown",
			documentID: undefined,
		});
	});
});
