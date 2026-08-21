/**
 * El aplanado de los créditos para el menú del bot.
 *
 * El motor de SimpleTech no recorre arreglos: arma el menú con una plantilla
 * por cantidad de opciones y lee campos sueltos. Lo que se prueba acá es lo que
 * él necesita para no equivocarse de crédito —que la etiqueta y el SIFCO de una
 * misma posición sean del mismo crédito— porque un desfase de uno le cobraría a
 * otra persona.
 */

import { describe, expect, test } from "bun:test";
import { aplanarCreditos, type CreditoBot } from "./buscar-cliente";

const credito = (numeroSifco: string, etiqueta: string): CreditoBot => ({
	numeroSifco,
	etiqueta,
	vehiculo: null,
});

const MAZDA = credito("01010214113290", "MAZDA CX-5 2016 · P-247JYT");
const YARIS = credito("01010214117590", "TOYOTA YARIS 2019 · P-882BFR");

describe("aplanarCreditos", () => {
	test("numera desde 1, no desde 0", () => {
		const plano = aplanarCreditos([MAZDA, YARIS]);

		expect(plano.etiqueta1).toBe(MAZDA.etiqueta);
		expect(plano.etiqueta2).toBe(YARIS.etiqueta);
		expect("etiqueta0" in plano).toBe(false);
	});

	test("la etiqueta y el SIFCO de una posición son del mismo crédito", () => {
		const plano = aplanarCreditos([MAZDA, YARIS]);

		expect(plano.numeroSifco1).toBe(MAZDA.numeroSifco);
		expect(plano.numeroSifco2).toBe(YARIS.numeroSifco);
	});

	test("cantidadCreditos es lo que decide qué menú mandar", () => {
		expect(aplanarCreditos([MAZDA]).cantidadCreditos).toBe(1);
		expect(aplanarCreditos([MAZDA, YARIS]).cantidadCreditos).toBe(2);
	});

	test("respeta el orden que trae la consulta", () => {
		const plano = aplanarCreditos([YARIS, MAZDA]);

		expect(plano.etiqueta1).toBe(YARIS.etiqueta);
		expect(plano.numeroSifco1).toBe(YARIS.numeroSifco);
	});

	test("no inventa una opción de más", () => {
		const plano = aplanarCreditos([MAZDA, YARIS]);

		expect("etiqueta3" in plano).toBe(false);
		expect("numeroSifco3" in plano).toBe(false);
	});

	// El controlador corta antes con SIN_CREDITOS, pero la función no puede
	// romperse si algún día la llama otro.
	test("sin créditos no explota", () => {
		const plano = aplanarCreditos([]);

		expect(plano.cantidadCreditos).toBe(0);
		expect(plano.creditos).toEqual([]);
	});

	test("el arreglo original sigue ahí para quien ya lo lee", () => {
		expect(aplanarCreditos([MAZDA, YARIS]).creditos).toEqual([MAZDA, YARIS]);
	});
});
