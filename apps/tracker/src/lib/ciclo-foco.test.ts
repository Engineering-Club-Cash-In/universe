import { describe, expect, test } from "bun:test";
import { destinoDelTab } from "./ciclo-foco";

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

	test("sin elementos enfocables no hace nada", () => {
		expect(destinoDelTab([], null, false)).toBeNull();
	});
});
