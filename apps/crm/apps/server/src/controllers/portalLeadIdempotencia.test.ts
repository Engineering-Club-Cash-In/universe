import { describe, expect, it } from "bun:test";

import { decidirLeadDelPortal } from "./portalLeadIdempotencia";

// Espejo del caso que ya cubre cartera con la marca de procedencia. Aquí el
// ancla no es una columna de propiedad —los leads no la tienen y añadirla es
// otra migración—, sino que el reintento pida el MISMO DPI que el lead guarda.
describe("decidirLeadDelPortal", () => {
	it("acepta el reintento que pide el mismo DPI del lead", () => {
		expect(decidirLeadDelPortal("1234567890123", "1234567890123")).toEqual({
			tipo: "aceptar",
		});
	});

	it("ignora el formato con el que quedó guardado el DPI", () => {
		// Las cargas viejas dejaron DPIs con espacios; son la misma persona.
		expect(decidirLeadDelPortal("1234 56789 0123", "1234567890123")).toEqual({
			tipo: "aceptar",
		});
	});

	// El hallazgo del camino de CLIENT: el lead se creó con el DPI A, el alta
	// falló después en auth-google y el reintento trae el DPI B. El CRM casaba
	// el lead por correo y lo devolvía como éxito SIN actualizar su DPI,
	// mientras auth-google escribía B en la cuenta: los dos sistemas quedaban
	// con identidades distintas, y B puede ser de otra persona.
	it("rechaza el reintento que trae otro DPI", () => {
		expect(decidirLeadDelPortal("1111111111111", "2222222222222")).toEqual({
			tipo: "conflicto_dpi",
		});
	});

	// Rellenarlo sería peor: con el correo sin verificar, quien controle un
	// correo le estamparía su DPI al lead de otra persona.
	it("acepta un lead sin DPI sin escribirle nada", () => {
		expect(decidirLeadDelPortal(null, "1234567890123")).toEqual({
			tipo: "aceptar",
		});
		expect(decidirLeadDelPortal("   ", "1234567890123")).toEqual({
			tipo: "aceptar",
		});
	});
});
