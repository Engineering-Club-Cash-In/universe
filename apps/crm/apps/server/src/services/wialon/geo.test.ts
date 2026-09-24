import { describe, expect, test } from "bun:test";
import { puntoDentroDePoligono } from "./geo";

// Cuadrado simple 0,0 → 10,10 para casos borde controlados.
const cuadrado = [
	{ x: 0, y: 0 },
	{ x: 10, y: 0 },
	{ x: 10, y: 10 },
	{ x: 0, y: 10 },
];

describe("puntoDentroDePoligono — cuadrado simple", () => {
	test("centro del cuadrado: dentro", () => {
		expect(puntoDentroDePoligono(5, 5, cuadrado)).toBe(true);
	});

	test("claramente afuera: fuera", () => {
		expect(puntoDentroDePoligono(50, 50, cuadrado)).toBe(false);
	});

	test("menos de 3 vértices: siempre fuera", () => {
		expect(puntoDentroDePoligono(5, 5, [{ x: 0, y: 0 }])).toBe(false);
		expect(puntoDentroDePoligono(5, 5, [])).toBe(false);
	});
});

describe("puntoDentroDePoligono — polígono de Guatemala (aproximado, spike CB-119)", () => {
	// Vértices reales de "Perimetro cash" (zona 1, recurso CASH IN),
	// truncados a los puntos que definen el contorno relevante para este
	// test — mismo polígono que se ve en el spike de CB-119.
	const guatemala = [
		{ x: -90.0943414049, y: 13.7343956776 },
		{ x: -89.1241188214, y: 14.5859224975 },
		{ x: -89.1563892805, y: 15.0529081906 },
		{ x: -88.2177467512, y: 15.7099894222 },
		{ x: -89.2010231182, y: 15.9002668676 },
		{ x: -90.1952858134, y: 17.824216443 },
		{ x: -91.4587135476, y: 17.2428062466 },
		{ x: -92.2112632394, y: 15.2653199503 },
		{ x: -92.1364251448, y: 14.8880680763 },
		{ x: -91.554830134, y: 14.0456818122 },
		{ x: -90.5193687084, y: 13.9124198672 },
	];

	test("Ciudad de Guatemala: dentro", () => {
		// zona 1 de golf, centro aprox de la capital.
		expect(puntoDentroDePoligono(14.6349, -90.5069, guatemala)).toBe(true);
	});

	test("San Salvador (El Salvador, fuera del polígono): fuera", () => {
		expect(puntoDentroDePoligono(13.6929, -89.2182, guatemala)).toBe(false);
	});

	test("Océano Pacífico frente a la costa: fuera", () => {
		expect(puntoDentroDePoligono(13.5, -92.0, guatemala)).toBe(false);
	});
});
