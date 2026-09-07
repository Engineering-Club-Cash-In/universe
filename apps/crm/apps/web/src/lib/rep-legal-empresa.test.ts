import { describe, expect, it } from "bun:test";
import {
	errorRepLegal,
	esEmpresaInicial,
	REP_LEGAL_REQUERIDO,
	requiereConfirmacionBorrado,
	valorRepLegalAEnviar,
} from "./rep-legal-empresa";

describe("interruptor ¿Es empresa?", () => {
	it("arranca marcado cuando la fila ya tiene representante", () => {
		expect(esEmpresaInicial("01234567")).toBe(true);
	});

	it("arranca sin marcar sin representante guardado", () => {
		expect(esEmpresaInicial(undefined)).toBe(false);
		expect(esEmpresaInicial(null)).toBe(false);
		expect(esEmpresaInicial("")).toBe(false);
		expect(esEmpresaInicial("   ")).toBe(false);
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

describe("valor a enviar", () => {
	it("crear: sin empresa manda la llave ausente (cartera no toca nada)", () => {
		expect(
			valorRepLegalAEnviar(false, "123", { borrarSiNoEsEmpresa: false }),
		).toBeUndefined();
	});

	it("editar: sin empresa manda cadena vacía (cartera borra)", () => {
		expect(
			valorRepLegalAEnviar(false, "123", { borrarSiNoEsEmpresa: true }),
		).toBe("");
	});

	it("conserva los ceros a la izquierda tal cual", () => {
		expect(
			valorRepLegalAEnviar(true, "01234567", { borrarSiNoEsEmpresa: true }),
		).toBe("01234567");
	});
});

describe("confirmación de borrado", () => {
	it("la pide al desmarcar a quien ya tenía representante", () => {
		expect(requiereConfirmacionBorrado("123", false)).toBe(true);
	});

	it("no la pide si nunca tuvo representante", () => {
		expect(requiereConfirmacionBorrado(null, false)).toBe(false);
	});

	it("no la pide si el interruptor sigue marcado", () => {
		expect(requiereConfirmacionBorrado("123", true)).toBe(false);
	});
});
