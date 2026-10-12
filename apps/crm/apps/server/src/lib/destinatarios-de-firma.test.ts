import { describe, expect, test } from "bun:test";
import {
	destinatariosDeFirma,
	rolesDelDestinatario,
} from "./destinatarios-de-firma";

const lead = (clientType: string) => ({
	id: "lead",
	nombre: "Cliente Prueba",
	email: "cliente@prueba.test",
	phone: "50200000000",
	clientType,
});
const codeudor = (id: string, esRepresentanteLegal = false) => ({
	id,
	fullName: `Codeudor ${id}`,
	email: `${id}@prueba.test`,
	phone: `5021111000${id.length}`,
	esRepresentanteLegal,
});

describe("a quién le llegan los enlaces", () => {
	test("una persona: el cliente como titular y los codeudores cofirman", () => {
		const lista = destinatariosDeFirma({
			lead: lead("individual"),
			codeudores: [codeudor("a")],
		});
		expect(lista.map((d) => [d.role, d.leadId ?? d.coDebtorId])).toEqual([
			["TITULAR", "lead"],
			["COFIRMANTE", "a"],
			["REP_LEGAL", undefined],
		]);
		// Un codeudor puede figurar como titular en lo subido a mano.
		expect(rolesDelDestinatario(lista[1])).toEqual(["COFIRMANTE", "TITULAR"]);
	});

	test("una sociedad: le llegan al representante, no a la empresa", () => {
		const lista = destinatariosDeFirma({
			lead: lead("empresa"),
			codeudores: [codeudor("rep", true)],
		});
		expect(lista.map((d) => [d.role, d.leadId ?? d.coDebtorId])).toEqual([
			["TITULAR", "rep"],
			["REP_LEGAL", undefined],
		]);
		expect(lista[0].email).toBe("rep@prueba.test");
		expect(lista[0].nombre).toBe("Codeudor rep");
		expect(rolesDelDestinatario(lista[0])).toEqual(["TITULAR", "COFIRMANTE"]);
	});

	test("empresa sin representante identificable: como siempre", () => {
		const lista = destinatariosDeFirma({
			lead: lead("empresa"),
			codeudores: [codeudor("a"), codeudor("b")],
		});
		expect(lista.map((d) => d.role)).toEqual([
			"TITULAR",
			"COFIRMANTE",
			"COFIRMANTE",
			"REP_LEGAL",
		]);
		expect(lista[0].leadId).toBe("lead");
	});
});
