import { describe, expect, test } from "bun:test";
import {
	avisoCuentaSuspendida,
	cerrarSiSePuede,
	correoValido,
	esUltimoGerenteActivo,
	mensajeDeError,
	puedeCerrar,
	reintentoConfirmado,
	requiereConfirmacionPromocion,
} from "./gerentes-agencia";

const g = (id: string, activa: boolean, cuentaSuspendida = false) => ({
	id,
	activa,
	cuentaSuspendida,
});

describe("esUltimoGerenteActivo", () => {
	test("el único activo es el último", () => {
		expect(esUltimoGerenteActivo([g("a", true), g("b", false)], "a")).toBe(true);
	});
	test("con otro activo no es el último", () => {
		expect(esUltimoGerenteActivo([g("a", true), g("b", true)], "a")).toBe(false);
	});
	test("uno ya inactivo no genera advertencia al desactivarse de nuevo", () => {
		expect(esUltimoGerenteActivo([g("a", false), g("b", true)], "a")).toBe(false);
	});
	test("un gerente con la cuenta suspendida no cuenta como activo", () => {
		// "b" no puede entrar: desactivar a "a" deja la agencia sin gerente operativo
		expect(esUltimoGerenteActivo([g("a", true), g("b", true, true)], "a")).toBe(true);
	});
	test("el único activo pero suspendido no es el último operativo", () => {
		expect(esUltimoGerenteActivo([g("a", true, true), g("b", false)], "a")).toBe(false);
	});
});

describe("requiereConfirmacionPromocion", () => {
	test("reconoce el CONFLICT con requiereConfirmacion", () => {
		const e = { code: "CONFLICT", data: { requiereConfirmacion: true } };
		expect(requiereConfirmacionPromocion(e)).toBe(true);
	});
	test("otro conflicto no pide confirmar", () => {
		expect(requiereConfirmacionPromocion({ code: "CONFLICT", data: {} })).toBe(false);
		expect(requiereConfirmacionPromocion(new Error("x"))).toBe(false);
		expect(requiereConfirmacionPromocion(null)).toBe(false);
	});
});

describe("mensajeDeError", () => {
	test("prefiere el mensaje en español de la validación", () => {
		const e = {
			message: "Input validation failed",
			data: { issues: [{ message: "Correo inválido" }] },
		};
		expect(mensajeDeError(e)).toBe("Correo inválido");
	});
	test("sin issues usa el message", () => {
		expect(mensajeDeError(new Error("Ese usuario ya es gerente"))).toBe(
			"Ese usuario ya es gerente",
		);
		expect(mensajeDeError({ message: "x", data: { issues: [] } })).toBe("x");
	});
	test("valor raro no truena", () => {
		expect(mensajeDeError(null)).toBe("Error desconocido");
	});
});

describe("correoValido", () => {
	test("rechaza dominio sin punto, que el navegador acepta", () => {
		expect(correoValido("juan@agencia")).toBe(false);
		expect(correoValido("")).toBe(false);
	});
	test("acepta un correo normal", () => {
		expect(correoValido(" juan@agencia.com ")).toBe(true);
	});
});

describe("puedeCerrar", () => {
	test("no se puede cerrar con una mutación pendiente", () => {
		expect(puedeCerrar(true)).toBe(false);
	});
	test("se puede cerrar cuando no hay nada en vuelo", () => {
		expect(puedeCerrar(false)).toBe(true);
	});
});

describe("cerrarSiSePuede", () => {
	test("con la mutación pendiente no cierra ni limpia nada", () => {
		const pasos: string[] = [];
		const cerro = cerrarSiSePuede(
			true,
			() => pasos.push("padre"),
			() => pasos.push("reset"),
		);
		expect(cerro).toBe(false);
		expect(pasos).toEqual([]);
	});
	test("sin nada en vuelo cierra primero el padre y luego limpia el formulario", () => {
		const pasos: string[] = [];
		const cerro = cerrarSiSePuede(
			false,
			() => pasos.push("padre"),
			() => pasos.push("reset"),
		);
		expect(cerro).toBe(true);
		expect(pasos).toEqual(["padre", "reset"]);
	});
});

describe("reintentoConfirmado", () => {
	test("reenvía lo enviado con la confirmación en true", () => {
		expect(
			reintentoConfirmado({ nombre: "Ana", correo: "a@x.com", confirmarPromocion: false }),
		).toEqual({ nombre: "Ana", correo: "a@x.com", confirmarPromocion: true });
	});
	test("no arrastra campos ajenos al payload ni muta el original", () => {
		const enviado = {
			nombre: "Ana",
			correo: "a@x.com",
			confirmarPromocion: false,
			extra: 1,
		};
		const r = reintentoConfirmado(enviado);
		expect(Object.keys(r).sort()).toEqual(["confirmarPromocion", "correo", "nombre"]);
		expect(enviado.confirmarPromocion).toBe(false);
	});
});

describe("avisoCuentaSuspendida", () => {
	test("cuenta suspendida: avisa que sigue sin entrar", () => {
		expect(avisoCuentaSuspendida({ cuentaSuspendida: true })).toBe(
			"Su cuenta sigue suspendida: no podrá entrar al tracker hasta que un administrador la reactive en Usuarios.",
		);
	});
	test("cuenta normal: sin aviso", () => {
		expect(avisoCuentaSuspendida({ cuentaSuspendida: false })).toBeNull();
	});
});
