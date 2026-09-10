import { describe, expect, test } from "bun:test";
import {
	guardarFiltroPeriodo,
	leerFiltroPeriodo,
	limpiarFiltroPeriodo,
} from "./filtro-periodo";

function almacenamientoDePrueba(inicial: Record<string, string> = {}) {
	const datos = new Map(Object.entries(inicial));
	return {
		getItem: (clave: string) => datos.get(clave) ?? null,
		setItem: (clave: string, valor: string) => {
			datos.set(clave, valor);
		},
		removeItem: (clave: string) => {
			datos.delete(clave);
		},
		_datos: datos,
	};
}

describe("filtro-periodo", () => {
	test("guarda y lee el período de un socio", () => {
		const storage = almacenamientoDePrueba();
		guardarFiltroPeriodo("socio-1", { periodo: "9", anio: 2026 }, storage);
		expect(leerFiltroPeriodo("socio-1", storage)).toEqual({
			periodo: "9",
			anio: 2026,
		});
	});

	test("un socio no ve el período guardado de otro (namespacing)", () => {
		const storage = almacenamientoDePrueba();
		guardarFiltroPeriodo("socio-1", { periodo: "9", anio: 2026 }, storage);
		expect(leerFiltroPeriodo("socio-2", storage)).toBeNull();
	});

	test("sin identificador de socio no lee ni escribe", () => {
		const storage = almacenamientoDePrueba();
		guardarFiltroPeriodo(null, { periodo: "9", anio: 2026 }, storage);
		expect(storage._datos.size).toBe(0);
		expect(leerFiltroPeriodo(null, storage)).toBeNull();
	});

	test("ignora un valor corrupto o con forma inesperada", () => {
		const storage = almacenamientoDePrueba({
			"tracker:filtro-periodo:v1:socio-1": "{no-es-json",
		});
		expect(leerFiltroPeriodo("socio-1", storage)).toBeNull();

		const storage2 = almacenamientoDePrueba({
			"tracker:filtro-periodo:v1:socio-1": JSON.stringify({ periodo: 9 }),
		});
		expect(leerFiltroPeriodo("socio-1", storage2)).toBeNull();
	});

	test("limpiarFiltroPeriodo borra solo la clave del socio indicado", () => {
		const storage = almacenamientoDePrueba();
		guardarFiltroPeriodo("socio-1", { periodo: "9", anio: 2026 }, storage);
		guardarFiltroPeriodo("socio-2", { periodo: "3", anio: 2026 }, storage);
		limpiarFiltroPeriodo("socio-1", storage);
		expect(leerFiltroPeriodo("socio-1", storage)).toBeNull();
		expect(leerFiltroPeriodo("socio-2", storage)).toEqual({
			periodo: "3",
			anio: 2026,
		});
	});

	test("no revienta si storage.setItem lanza (cuota llena / modo privado)", () => {
		const storage = {
			getItem: () => null,
			setItem: () => {
				throw new Error("QuotaExceededError");
			},
			removeItem: () => {},
		};
		expect(() =>
			guardarFiltroPeriodo("socio-1", { periodo: "9", anio: 2026 }, storage),
		).not.toThrow();
	});
});
