import { describe, expect, it } from "bun:test";

import { decidirLeadDelPortal } from "./portalLeadIdempotencia";

const CORREO = "ana@ejemplo.com";

// Espejo del caso que ya cubre cartera con la marca de procedencia. Aquí el
// ancla no es una columna de propiedad —los leads no la tienen y añadirla es
// otra migración—, sino que el reintento venga del correo del que cuelga el
// lead y pida el MISMO DPI que el lead guarda.
describe("decidirLeadDelPortal", () => {
	it("acepta el reintento que pide el mismo DPI del lead", () => {
		expect(
			decidirLeadDelPortal("1234567890123", "1234567890123", CORREO, CORREO),
		).toEqual({ tipo: "aceptar" });
	});

	it("ignora el formato con el que quedó guardado el DPI", () => {
		// Las cargas viejas dejaron DPIs con espacios; son la misma persona.
		expect(
			decidirLeadDelPortal("1234 56789 0123", "1234567890123", CORREO, CORREO),
		).toEqual({ tipo: "aceptar" });
	});

	// El hallazgo del camino de CLIENT: el lead se creó con el DPI A, el alta
	// falló después en auth-google y el reintento trae el DPI B. El CRM casaba
	// el lead por correo y lo devolvía como éxito SIN actualizar su DPI,
	// mientras auth-google escribía B en la cuenta: los dos sistemas quedaban
	// con identidades distintas, y B puede ser de otra persona.
	it("rechaza el reintento que trae otro DPI", () => {
		expect(
			decidirLeadDelPortal("1111111111111", "2222222222222", CORREO, CORREO),
		).toEqual({ tipo: "conflicto_dpi" });
	});

	// Rellenarlo sería peor: con el correo sin verificar, quien controle un
	// correo le estamparía su DPI al lead de otra persona. Pero tampoco es el
	// mismo "aceptar" que el reintento que coincide: la ficha se queda SIN DPI
	// y nadie se entera, así que el caso se distingue para poder reportarlo en
	// la respuesta en vez de contestar un éxito liso.
	it("acepta un lead sin DPI, pero marcando que no se le escribió", () => {
		expect(decidirLeadDelPortal(null, "1234567890123", CORREO, CORREO)).toEqual(
			{ tipo: "aceptar_sin_dpi" },
		);
		expect(
			decidirLeadDelPortal("   ", "1234567890123", CORREO, CORREO),
		).toEqual({ tipo: "aceptar_sin_dpi" });
	});
});

// El hallazgo P1: la búsqueda del CRM es `correo O DPI`, así que un CLIENT que
// manda el DPI de un lead ajeno —todavía no dado de alta en `users.dpi`, que es
// lo único que revisa auth-google antes— casa esa ficha SOLO por el DPI. La
// decisión la aceptaba como reintento propio porque los DPIs coinciden, y
// `register-external-auth` terminaba grabando el DPI de la víctima en la cuenta
// del atacante y devolviéndole los datos del lead ajeno.
describe("decidirLeadDelPortal: el lead tiene que colgar del correo de la sesión", () => {
	it("rechaza el lead que coincide en DPI pero cuelga de otro correo", () => {
		expect(
			decidirLeadDelPortal(
				"1234567890123",
				"1234567890123",
				"victima@ejemplo.com",
				"atacante@ejemplo.com",
			),
		).toEqual({ tipo: "conflicto_correo" });
	});

	// Una ficha vieja con DPI y sin correo no está ligada a nadie: aceptarla por
	// el DPI es dársela a quien lo acierte, y encima le escribía encima el correo
	// de quien preguntó. Ponerle el correo es trabajo de back office.
	it("rechaza el lead sin correo que solo casó por el DPI", () => {
		expect(
			decidirLeadDelPortal("1234567890123", "1234567890123", null, CORREO),
		).toEqual({ tipo: "conflicto_correo" });
		expect(
			decidirLeadDelPortal("1234567890123", "1234567890123", "  ", CORREO),
		).toEqual({ tipo: "conflicto_correo" });
	});

	// Sin correo de sesión no hay identidad contra la que comparar: si se dejara
	// pasar, empataría con los leads sin correo y volvería a abrir el hallazgo.
	it("rechaza cuando la sesión no trae correo", () => {
		expect(
			decidirLeadDelPortal("1234567890123", "1234567890123", null, ""),
		).toEqual({ tipo: "conflicto_correo" });
		expect(
			decidirLeadDelPortal("1234567890123", "1234567890123", CORREO, null),
		).toEqual({ tipo: "conflicto_correo" });
	});

	// El caso legítimo que NO se puede romper: es la ficha de la persona, pero el
	// correo quedó guardado con otro formato. La búsqueda en base usa `=`
	// exacto, así que esta ficha aparece solo por el DPI y un `===` crudo la
	// tomaría por ajena.
	it("acepta el lead propio aunque su correo esté guardado con otro formato", () => {
		expect(
			decidirLeadDelPortal(
				"1234567890123",
				"1234567890123",
				"  Ana@Ejemplo.COM ",
				CORREO,
			),
		).toEqual({ tipo: "aceptar" });
	});
});
