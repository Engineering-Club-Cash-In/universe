import { describe, expect, test } from "bun:test";
import { confirmaDomicilio, distanciaMetros, parsearCoordenadas } from "./geo";

describe("distanciaMetros", () => {
	test("mismo punto: 0 metros", () => {
		expect(distanciaMetros(14.6349, -90.5069, 14.6349, -90.5069)).toBe(0);
	});

	test("dos puntos conocidos en Ciudad de Guatemala, ~1 km de separación real", () => {
		// Plaza Central (14.6407, -90.5133) a la Torre del Reformador
		// (14.6013, -90.5136), ~4.4 km en línea recta.
		const metros = distanciaMetros(14.6407, -90.5133, 14.6013, -90.5136);
		expect(metros).toBeGreaterThan(4300);
		expect(metros).toBeLessThan(4500);
	});

	test("simétrica: A→B es igual a B→A", () => {
		const ab = distanciaMetros(14.6349, -90.5069, 14.62, -90.51);
		const ba = distanciaMetros(14.62, -90.51, 14.6349, -90.5069);
		expect(ab).toBeCloseTo(ba, 6);
	});
});

describe("parsearCoordenadas", () => {
	test("par lat, lon pegado a mano", () => {
		expect(parsearCoordenadas("14.6349, -90.5069")).toEqual({
			lat: 14.6349,
			lon: -90.5069,
		});
	});

	test("link de Google Maps con @lat,lon", () => {
		expect(
			parsearCoordenadas(
				"https://www.google.com/maps/place/Zona+10/@14.5951,-90.5069,17z/data=!3m1",
			),
		).toEqual({ lat: 14.5951, lon: -90.5069 });
	});

	test("link con !3d!4d (el punto exacto, no el centro del mapa)", () => {
		expect(
			parsearCoordenadas(
				"https://www.google.com/maps/place/X/@14.6,-90.5,17z/data=!3d14.5951!4d-90.5069",
			),
		).toEqual({ lat: 14.5951, lon: -90.5069 });
	});

	test("link con ?q=lat,lon", () => {
		expect(
			parsearCoordenadas("https://www.google.com/maps?q=14.5951,-90.5069"),
		).toEqual({ lat: 14.5951, lon: -90.5069 });
	});

	test("rechaza texto sin coordenadas, fuera de rango y 0,0", () => {
		expect(parsearCoordenadas("zona 10 ciudad")).toBeNull();
		expect(parsearCoordenadas("95, -90")).toBeNull();
		expect(parsearCoordenadas("14, 190")).toBeNull();
		expect(parsearCoordenadas("0, 0")).toBeNull();
	});

	test("un % suelto no revienta", () => {
		expect(parsearCoordenadas("100% raro")).toBeNull();
	});
});

describe("confirmaDomicilio", () => {
	test("dentro de radio + margen confirma; fuera no", () => {
		expect(confirmaDomicilio(120, 50)).toBe(true);
		expect(confirmaDomicilio(200, 50)).toBe(true);
		expect(confirmaDomicilio(201, 50)).toBe(false);
		expect(confirmaDomicilio(2000, 50)).toBe(false);
	});
});
