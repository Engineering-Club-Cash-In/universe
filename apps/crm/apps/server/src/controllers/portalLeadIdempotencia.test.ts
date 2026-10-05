import { describe, expect, it } from "bun:test";

import {
	decidirLeadDelPortal,
	elegirLeadDelPortal,
} from "./portalLeadIdempotencia";

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

// `leads.email` no tiene índice único, así que dos fichas pueden colgar del
// mismo correo con solo diferir en la caja o en un espacio. La búsqueda
// normaliza los dos lados, de modo que las trae a las dos, y antes se tomaba la
// primera en silencio: a partir de ahí todo lo que el portal hace colgado de la
// sesión —perfil, documentos, contratos, créditos, actualizaciones— leía y
// escribía sobre una ficha elegida por antigüedad.
describe("elegirLeadDelPortal", () => {
	const ana = { id: 1, email: "ana@ejemplo.com", dpi: "1234567890123" };
	const anaOtraCaja = { id: 2, email: "  Ana@Ejemplo.COM ", dpi: "9999999999999" };
	const porDpi = { id: 3, email: "otro@ejemplo.com", dpi: "1234567890123" };

	it("elige la ficha que cuelga del correo de la sesión", () => {
		expect(
			elegirLeadDelPortal([porDpi, ana], {
				correo: "ana@ejemplo.com",
				dpi: "1234567890123",
			}),
		).toEqual({ tipo: "uno", lead: ana });
	});

	it("la reconoce aunque su correo esté guardado con otro formato", () => {
		expect(
			elegirLeadDelPortal([anaOtraCaja], { correo: "ana@ejemplo.com" }),
		).toEqual({ tipo: "uno", lead: anaOtraCaja });
	});

	// Con dos personas distintas capturadas bajo el mismo correo —pasa: el
	// contacto de una empresa, un familiar— elegir por antigüedad es enseñarle a
	// una los datos de la otra.
	it("no elige ninguna cuando dos fichas cuelgan del mismo correo", () => {
		expect(
			elegirLeadDelPortal([ana, anaOtraCaja], { correo: "ana@ejemplo.com" }),
		).toEqual({ tipo: "ambiguo", ids: [1, 2] });
	});

	// El DPI sí desempata, y no lo elige quien llama: auth-google manda el de la
	// CUENTA. Y solo escoge entre fichas que ya cuelgan de ese correo, así que no
	// puede traer una ajena.
	it("deja que el DPI de la cuenta desempate", () => {
		expect(
			elegirLeadDelPortal([ana, anaOtraCaja], {
				correo: "ana@ejemplo.com",
				dpi: "9999-9999-99999",
			}),
		).toEqual({ tipo: "uno", lead: anaOtraCaja });
	});

	it("sigue siendo ambiguo si el DPI no está en ninguna de las dos", () => {
		expect(
			elegirLeadDelPortal([ana, anaOtraCaja], {
				correo: "ana@ejemplo.com",
				dpi: "5555555555555",
			}),
		).toEqual({ tipo: "ambiguo", ids: [1, 2] });
	});

	// El camino sin correo no cambia: ahí no hay identidad de sesión que anclar y
	// los empates son duplicados de DPI con formatos distintos, entre los que la
	// más antigua arrastra el historial.
	it("sin correo se queda con la más antigua", () => {
		expect(elegirLeadDelPortal([porDpi, ana], { dpi: "1234567890123" })).toEqual(
			{ tipo: "uno", lead: porDpi },
		);
	});

	it("y también cuando ninguna cuelga de ese correo", () => {
		expect(
			elegirLeadDelPortal([porDpi], {
				correo: "nadie@ejemplo.com",
				dpi: "1234567890123",
			}),
		).toEqual({ tipo: "uno", lead: porDpi });
	});

	it("dice que no hay ninguna cuando no hay candidatos", () => {
		expect(elegirLeadDelPortal([], { correo: "ana@ejemplo.com" })).toEqual({
			tipo: "ninguno",
		});
	});
});
