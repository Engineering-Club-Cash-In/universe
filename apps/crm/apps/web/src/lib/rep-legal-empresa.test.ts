import { describe, expect, it } from "bun:test";
import {
	errorRepLegal,
	esEmpresaInicial,
	REP_LEGAL_REQUERIDO,
	requiereConfirmacionBorrado,
	valorRepLegalAEnviar,
	valorRepLegalAlGuardar,
} from "./rep-legal-empresa";

describe("interruptor ¿Es empresa?", () => {
	it("arranca marcado cuando la fila ya tiene representante", () => {
		expect(esEmpresaInicial("01234567", null)).toBe(true);
	});

	it("arranca sin marcar sin representante guardado", () => {
		expect(esEmpresaInicial(undefined, null)).toBe(false);
		expect(esEmpresaInicial(null, null)).toBe(false);
		expect(esEmpresaInicial("", null)).toBe(false);
		expect(esEmpresaInicial("   ", null)).toBe(false);
	});
});

describe("validación del DPI del representante", () => {
	it("lo exige con el interruptor marcado", () => {
		expect(errorRepLegal(true, "")).toBe(REP_LEGAL_REQUERIDO);
		expect(errorRepLegal(true, "  ")).toBe(REP_LEGAL_REQUERIDO);
	});

	it("no lo exige con el interruptor sin marcar", () => {
		expect(errorRepLegal(false, "")).toBeUndefined();
	});

	it("acepta el DPI con ceros a la izquierda", () => {
		expect(errorRepLegal(true, "01234567")).toBeUndefined();
	});
});

// La forma vieja, viva por la única llamada del alta (ver el comentario en
// `rep-legal-empresa.ts`).
describe("valor a enviar — la forma del alta", () => {
	it("crear: sin empresa manda la llave ausente (cartera no toca nada)", () => {
		expect(
			valorRepLegalAEnviar(false, "123", { borrarSiNoEsEmpresa: false }),
		).toBeUndefined();
	});

	it("conserva los ceros a la izquierda tal cual", () => {
		expect(
			valorRepLegalAEnviar(true, "01234567", { borrarSiNoEsEmpresa: false }),
		).toBe("01234567");
	});
});

describe("valor a enviar", () => {
	const guardar = (
		over: Partial<Parameters<typeof valorRepLegalAlGuardar>[0]> = {},
	) =>
		valorRepLegalAlGuardar({
			esEmpresa: true,
			valor: "01234567",
			repLegalOriginal: null,
			dpiOriginal: null,
			dpiDelFormulario: null,
			...over,
		});

	it("crear: sin empresa manda la llave ausente (cartera no toca nada)", () => {
		expect(guardar({ esEmpresa: false, valor: "123" })).toBeUndefined();
	});

	it("editar: al desmarcar a quien SÍ tenía representante manda cadena vacía (cartera borra)", () => {
		expect(
			guardar({
				esEmpresa: false,
				valor: "123",
				repLegalOriginal: "999",
				dpiOriginal: "111",
				dpiDelFormulario: "111",
			}),
		).toBe("");
	});

	it("conserva los ceros a la izquierda tal cual", () => {
		expect(guardar()).toBe("01234567");
	});
});

// El inversionista 187: `dpi = 4036613`, `dpi_rep_legal = '04036613'`. Abre con
// el interruptor apagado porque se representa a sí mismo.
describe("el que es su propio representante", () => {
	const guardar = (dpiDelFormulario: string | number | null) =>
		valorRepLegalAlGuardar({
			esEmpresa: false,
			valor: "",
			repLegalOriginal: "04036613",
			dpiOriginal: 4036613,
			dpiDelFormulario,
		});

	it("no se le toca el campo si lo editado fue otra cosa", () => {
		expect(guardar(4036613)).toBeUndefined();
		expect(guardar("04036613")).toBeUndefined();
	});

	// Sin esto, `dpi_rep_legal` se quedaba con el DPI VIEJO y `dpi` con el nuevo:
	// dos números distintos, que es literalmente la definición de empresa que usa
	// el backend. La fila dejaba de recibir cuenta propia y pasaba a estar
	// representada por una identidad que ya no es la suya.
	it("le sigue el DPI cuando lo editado fue el DPI", () => {
		expect(guardar(5551234)).toBe("5551234");
	});

	it("se borra si el DPI se dejó vacío: conservar el viejo lo volvía empresa", () => {
		expect(guardar("")).toBe("");
		expect(guardar(null)).toBe("");
	});
});

describe("confirmación de borrado", () => {
	it("la pide al desmarcar a quien ya tenía representante", () => {
		expect(requiereConfirmacionBorrado("123", false, null)).toBe(true);
	});

	it("no la pide si nunca tuvo representante", () => {
		expect(requiereConfirmacionBorrado(null, false, null)).toBe(false);
	});

	it("no la pide si el interruptor sigue marcado", () => {
		expect(requiereConfirmacionBorrado("123", true, null)).toBe(false);
	});
});

/**
 * Representarse a sí mismo NO es ser una empresa.
 *
 * Caso real de producción: el inversionista 187 (Javier Kafie) tiene
 * `dpi = 4036613` y `dpi_rep_legal = '04036613'`. Es el MISMO número con un
 * cero delante, porque `dpi` es bigint y `dpi_rep_legal` varchar. El backend ya
 * los normaliza y lo trata como PERSONA (`esEmpresaRepresentada` en
 * `cartera-back/src/utils/functions/provisionamientoPortal.ts`).
 *
 * Mientras el front derive el interruptor de "el campo no está vacío", esa fila
 * se abre etiquetada como empresa y, al desmarcar, se le advierte al operador
 * que le va a quitar el acceso "a otra persona". No hay otra persona.
 */
describe("el que se representa a sí mismo es una persona", () => {
	it("no marca el interruptor cuando el representante es la propia fila", () => {
		expect(esEmpresaInicial("04036613", 4036613)).toBe(false);
	});

	it("sigue marcándolo cuando el representante es OTRO", () => {
		expect(esEmpresaInicial("1573661970101", 4036613)).toBe(true);
	});

	it("tampoco pide confirmación para quitarle un representante que es él mismo", () => {
		expect(requiereConfirmacionBorrado("04036613", false, 4036613)).toBe(false);
	});

	it("sí la pide cuando el representante era otra persona", () => {
		expect(requiereConfirmacionBorrado("1573661970101", false, 4036613)).toBe(true);
	});
});
