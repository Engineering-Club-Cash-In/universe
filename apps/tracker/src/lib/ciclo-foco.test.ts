import { describe, expect, test } from "bun:test";
import { cierraSinBoton, destinoDelTab, ENFOCABLES } from "./ciclo-foco";

const [cerrar, ver, reenviar] = ["cerrar", "ver", "reenviar"];
const enfocables = [cerrar, ver, reenviar];

describe("destinoDelTab", () => {
	test("Tab en el último vuelve al primero; Shift+Tab en el primero va al último", () => {
		expect(destinoDelTab(enfocables, reenviar, false)).toBe(cerrar);
		expect(destinoDelTab(enfocables, cerrar, true)).toBe(reenviar);
	});

	test("en medio de la ventana el navegador sigue su orden normal", () => {
		expect(destinoDelTab(enfocables, ver, false)).toBeNull();
		expect(destinoDelTab(enfocables, ver, true)).toBeNull();
		expect(destinoDelTab(enfocables, cerrar, false)).toBeNull();
	});

	test("si el foco está fuera de la ventana, vuelve a entrar por el extremo", () => {
		expect(destinoDelTab(enfocables, "boton-de-atras", false)).toBe(cerrar);
		expect(destinoDelTab(enfocables, "boton-de-atras", true)).toBe(reenviar);
		expect(destinoDelTab(enfocables, null, false)).toBe(cerrar);
	});

	test("con un solo elemento el foco se queda en él", () => {
		expect(destinoDelTab([cerrar], cerrar, false)).toBe(cerrar);
		expect(destinoDelTab([cerrar], cerrar, true)).toBe(cerrar);
	});

	test("sin elementos enfocables y sin respaldo no hace nada", () => {
		expect(destinoDelTab([], null, false)).toBeNull();
	});

	test("sin elementos enfocables devuelve el respaldo, hacia adelante y hacia atrás", () => {
		expect(destinoDelTab([], null, false, "panel")).toBe("panel");
		expect(destinoDelTab([], null, true, "panel")).toBe("panel");
		// Con el foco ya en el panel, Tab lo retiene en vez de dejarlo salir.
		expect(destinoDelTab([], "panel", false, "panel")).toBe("panel");
		expect(destinoDelTab([], "panel", true, "panel")).toBe("panel");
	});

	test("el respaldo no se usa si hay elementos enfocables", () => {
		expect(destinoDelTab(enfocables, ver, false, "panel")).toBeNull();
		expect(destinoDelTab(enfocables, reenviar, false, "panel")).toBe(cerrar);
	});
});

describe("cierraSinBoton", () => {
	test("una ventana normal se cierra con el fondo o Escape", () => {
		expect(cierraSinBoton(undefined)).toBe(true);
		expect(cierraSinBoton(false)).toBe(true);
	});

	test("una ventana protegida solo se cierra con sus botones", () => {
		expect(cierraSinBoton(true)).toBe(false);
	});
});

describe("ENFOCABLES", () => {
	test("usa :disabled para excluir también lo deshabilitado por un fieldset", () => {
		expect(ENFOCABLES).not.toContain("[disabled]");
		for (const control of ["button", "input", "select", "textarea"]) {
			expect(ENFOCABLES).toContain(`${control}:not(:disabled)`);
		}
	});
});
