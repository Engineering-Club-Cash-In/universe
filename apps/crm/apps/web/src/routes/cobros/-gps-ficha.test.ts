import { describe, expect, test } from "bun:test";
import {
	ESTADO_SENAL_CONFIG,
	formatCoordenadas,
	formatFechaSenal,
	formatIgnicion,
	formatUltimaSenal,
	formatVelocidad,
	googleMapsUrl,
	limpiarPlacaParaBusqueda,
	resolveEstadoSenal,
} from "./-gps-ficha";

const AHORA = new Date("2026-09-22T12:00:00Z");
const haceMs = (ms: number) => new Date(AHORA.getTime() - ms);
const MIN = 60 * 1000;
const HORA = 60 * MIN;
const DIA = 24 * HORA;

describe("formatUltimaSenal", () => {
	test("describe la antigüedad en minutos, horas y días", () => {
		expect(formatUltimaSenal(haceMs(30 * 1000), AHORA)).toBe(
			"hace menos de 1 min",
		);
		expect(formatUltimaSenal(haceMs(4 * MIN), AHORA)).toBe("hace 4 min");
		expect(formatUltimaSenal(haceMs(2 * HORA), AHORA)).toBe("hace 2 horas");
		expect(formatUltimaSenal(haceMs(3 * DIA), AHORA)).toBe("hace 3 días");
	});

	test("singulariza una hora y un día", () => {
		expect(formatUltimaSenal(haceMs(HORA), AHORA)).toBe("hace 1 hora");
		expect(formatUltimaSenal(haceMs(DIA), AHORA)).toBe("hace 1 día");
	});

	test("un reloj adelantado no produce tiempos negativos", () => {
		// El GPS puede reportar unos segundos "en el futuro" frente al servidor.
		const futuro = new Date(AHORA.getTime() + 20 * 1000);
		expect(formatUltimaSenal(futuro, AHORA)).toBe("hace menos de 1 min");
	});

	test("acepta strings ISO (lo que viaja por la red)", () => {
		expect(formatUltimaSenal(haceMs(5 * MIN).toISOString(), AHORA)).toBe(
			"hace 5 min",
		);
	});

	test("null, undefined y fechas inválidas no rompen", () => {
		for (const valor of [null, undefined, "no-es-fecha"]) {
			expect(formatUltimaSenal(valor, AHORA)).toBe("Sin señal registrada");
		}
	});
});

describe("resolveEstadoSenal", () => {
	test("clasifica fresca, tibia y vieja en sus fronteras", () => {
		expect(resolveEstadoSenal(haceMs(14 * MIN), AHORA)).toBe("fresca");
		// 15 min exactos ya no es fresca.
		expect(resolveEstadoSenal(haceMs(15 * MIN), AHORA)).toBe("tibia");
		expect(resolveEstadoSenal(haceMs(119 * MIN), AHORA)).toBe("tibia");
		// 2 h exactas ya es vieja.
		expect(resolveEstadoSenal(haceMs(2 * HORA), AHORA)).toBe("vieja");
		expect(resolveEstadoSenal(haceMs(3 * DIA), AHORA)).toBe("vieja");
	});

	test("sin fecha o fecha inválida es sin_datos", () => {
		expect(resolveEstadoSenal(null, AHORA)).toBe("sin_datos");
		expect(resolveEstadoSenal("basura", AHORA)).toBe("sin_datos");
	});

	test("todo estado tiene configuración visual", () => {
		for (const estado of ["fresca", "tibia", "vieja", "sin_datos"] as const) {
			expect(ESTADO_SENAL_CONFIG[estado].label.length).toBeGreaterThan(0);
			expect(ESTADO_SENAL_CONFIG[estado].badgeClass.length).toBeGreaterThan(0);
		}
	});
});

describe("formatIgnicion", () => {
	test("distingue encendido, apagado y sin dato", () => {
		// undefined NO es "apagado": nadie lo midió.
		expect(formatIgnicion(true).label).toBe("Encendido");
		expect(formatIgnicion(false).label).toBe("Apagado");
		expect(formatIgnicion(undefined).label).toBe("Sin dato");
	});
});

describe("formatVelocidad / formatCoordenadas / googleMapsUrl", () => {
	test("velocidad se redondea y tolera ausencia", () => {
		expect(formatVelocidad(12.4)).toBe("12 km/h");
		expect(formatVelocidad(0)).toBe("0 km/h");
		expect(formatVelocidad(undefined)).toBe("—");
		expect(formatVelocidad(Number.NaN)).toBe("—");
	});

	test("coordenadas se muestran con 6 decimales", () => {
		expect(formatCoordenadas(14.610365, -90.5158933)).toBe(
			"14.610365, -90.515893",
		);
		expect(formatCoordenadas(undefined, -90.5)).toBe("—");
	});

	test("el link al mapa es null sin posición, para no pintar un botón muerto", () => {
		expect(googleMapsUrl(14.610365, -90.5158933)).toBe(
			"https://www.google.com/maps?q=14.610365,-90.5158933",
		);
		expect(googleMapsUrl(undefined, undefined)).toBeNull();
		expect(googleMapsUrl(14.6, undefined)).toBeNull();
	});
});

describe("limpiarPlacaParaBusqueda", () => {
	test("se queda con los 3 dígitos del núcleo de la placa", () => {
		// Bug real: quitar el guion ("P278KJQ") tampoco encontraba nada, porque
		// Wialon SÍ conserva el guion en el nombre ("P-278KJQ...").
		expect(limpiarPlacaParaBusqueda("P - 278KJQ")).toBe("278");
		expect(limpiarPlacaParaBusqueda("C-856CBP")).toBe("856");
	});

	test("ignora el cero de más en placas tipeadas como P0-", () => {
		// Con todos los dígitos quedaba "0720", que no está en "P-720GVH...".
		expect(limpiarPlacaParaBusqueda("P0-720GVH")).toBe("720");
		expect(limpiarPlacaParaBusqueda("p0720gvh")).toBe("720");
	});

	test("con placa incompleta usa igual los 3 dígitos para acotar la búsqueda", () => {
		// Caso real: "P-572JX" en el CRM es la unidad "P-572JXL CON APAGADO".
		expect(limpiarPlacaParaBusqueda("P-572JX")).toBe("572");
	});

	test("tolera vacío y valores de relleno sin forma de placa", () => {
		for (const valor of ["", "ABC", "NUEVO", "N/A", "0"]) {
			expect(limpiarPlacaParaBusqueda(valor)).toBe("");
		}
	});
});

describe("formatFechaSenal", () => {
	test("formatea la fecha exacta y tolera nulos", () => {
		expect(formatFechaSenal(null)).toBe("—");
		expect(formatFechaSenal("no-es-fecha")).toBe("—");
		expect(formatFechaSenal(AHORA)).toContain("2026");
	});
});
