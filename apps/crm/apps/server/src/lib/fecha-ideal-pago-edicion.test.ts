import { describe, expect, test } from "bun:test";
import {
	puedeAsignarInversionistas,
	puedeCambiarDiaPago,
	requiereCongelarEtapaParaCambioDia,
} from "./fecha-ideal-pago-edicion";

describe("puedeCambiarDiaPago", () => {
	test("permite editar antes de asignar inversionistas", () => {
		expect(puedeCambiarDiaPago(50)).toBe(true);
	});

	test("congela el día desde la etapa jurídica", () => {
		expect(puedeCambiarDiaPago(80)).toBe(false);
		expect(puedeCambiarDiaPago(90)).toBe(false);
	});
});

describe("puedeAsignarInversionistas", () => {
	test("solo permite la transición desde 50%", () => {
		expect(puedeAsignarInversionistas(50)).toBe(true);
		expect(puedeAsignarInversionistas(80)).toBe(false);
	});
});

describe("requiereCongelarEtapaParaCambioDia", () => {
	test("solo condiciona el update cuando cambia el día o su intención", () => {
		expect(requiereCongelarEtapaParaCambioDia(false, false, false)).toBe(false);
		expect(requiereCongelarEtapaParaCambioDia(true, false, false)).toBe(true);
		expect(requiereCongelarEtapaParaCambioDia(false, true, false)).toBe(true);
		expect(requiereCongelarEtapaParaCambioDia(false, false, true)).toBe(true);
	});
});
