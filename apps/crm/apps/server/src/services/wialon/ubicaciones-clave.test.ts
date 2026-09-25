/**
 * CB-119 (D-15) — Algoritmo puro de "ubicaciones clave": detección de
 * estancias, clustering y clasificación. Sin I/O, todo con datos sintéticos.
 */
import { describe, expect, test } from "bun:test";
import {
	agruparEstancias,
	calcularUbicacionesClave,
	detectarEstancias,
} from "./ubicaciones-clave";
import type { WialonMensajePosicion } from "./wialon-types";

// Casa: Zona 10 (aprox). Trabajo: Zona 1. Lugar de fin de semana: Amatitlán.
const CASA = { lat: 14.5951, lon: -90.5069 };
const TRABAJO = { lat: 14.6407, lon: -90.5133 };
const SABADOS = { lat: 14.4772, lon: -90.6156 };

const EPOCH_BASE = Date.UTC(2026, 6, 1, 0, 0, 0) / 1000; // 2026-07-01 00:00 UTC

function horaGtAEpoch(diaOffset: number, horaGt: number): number {
	// horaGt en hora de Guatemala (UTC-6) → epoch en segundos UTC.
	return EPOCH_BASE + diaOffset * 86400 + (horaGt + 6) * 3600;
}

function msg(
	epoch: number,
	punto: { lat: number; lon: number },
	velocidadKmh: number | null = 0,
): WialonMensajePosicion {
	return { t: epoch, lat: punto.lat, lon: punto.lon, velocidadKmh };
}

describe("detectarEstancias", () => {
	test("mensajes en el mismo lugar, quietos, por más de 20 min: una estancia", () => {
		const mensajes = [
			msg(1000, CASA),
			msg(1000 + 10 * 60, CASA),
			msg(1000 + 25 * 60, CASA),
		];
		const estancias = detectarEstancias(mensajes);
		expect(estancias).toHaveLength(1);
		expect(estancias[0]?.lat).toBeCloseTo(CASA.lat, 3);
	});

	test("tramo corto (menos de 20 min): no cuenta como estancia", () => {
		const mensajes = [msg(1000, CASA), msg(1000 + 5 * 60, CASA)];
		expect(detectarEstancias(mensajes)).toHaveLength(0);
	});

	test("vehículo en movimiento (velocidad alta): no genera estancia", () => {
		const mensajes = [msg(1000, CASA, 60), msg(1000 + 30 * 60, CASA, 55)];
		expect(detectarEstancias(mensajes)).toHaveLength(0);
	});

	test("dos lugares distintos separados por viaje: dos estancias", () => {
		const mensajes = [
			msg(1000, CASA),
			msg(1000 + 30 * 60, CASA),
			msg(1000 + 40 * 60, TRABAJO, 80), // viaje
			msg(1000 + 60 * 60, TRABAJO),
			msg(1000 + 90 * 60, TRABAJO),
		];
		const estancias = detectarEstancias(mensajes);
		expect(estancias).toHaveLength(2);
	});

	test("hueco de horas sin mensajes en el mismo lugar: sigue siendo una sola estancia larga (el caso de la noche)", () => {
		const mensajes = [
			msg(1000, CASA),
			// 8 horas sin ningún mensaje — el vehículo estacionado de noche
			// simplemente no reporta.
			msg(1000 + 8 * 60 * 60, CASA),
		];
		const estancias = detectarEstancias(mensajes);
		expect(estancias).toHaveLength(1);
		const horas =
			(estancias[0]!.hasta.getTime() - estancias[0]!.desde.getTime()) /
			(60 * 60 * 1000);
		expect(horas).toBeCloseTo(8, 1);
	});
});

describe("agruparEstancias", () => {
	test("estancias en el mismo punto exacto se agrupan en un cluster", () => {
		const estancias = detectarEstancias([
			msg(1000, CASA),
			msg(1000 + 30 * 60, CASA),
			msg(1000 + 40 * 60, TRABAJO, 80),
			msg(1000 + 41 * 60 + 30 * 60, CASA),
			msg(1000 + 41 * 60 + 60 * 60, CASA),
		]);
		const clusters = agruparEstancias(estancias);
		// CASA aparece dos veces → un solo cluster con 2 visitas.
		const clusterCasa = clusters.find(
			(c) => Math.abs(c.lat - CASA.lat) < 0.001,
		);
		expect(clusterCasa?.visitas).toBe(2);
	});
});

describe("calcularUbicacionesClave — 60 días sintéticos", () => {
	function generarHistorialSesentaDias(): WialonMensajePosicion[] {
		const mensajes: WialonMensajePosicion[] = [];

		for (let dia = 0; dia < 60; dia++) {
			const fecha = new Date(EPOCH_BASE * 1000 + dia * 86400 * 1000);
			const diaSemanaUtc = fecha.getUTCDay();

			// Casa: todas las noches, 22:00-06:00 GT.
			mensajes.push(msg(horaGtAEpoch(dia, 22), CASA));
			mensajes.push(msg(horaGtAEpoch(dia, 23), CASA));
			mensajes.push(msg(horaGtAEpoch(dia + 1, 5), CASA));

			// Trabajo: L-V, 8:00-17:00 GT (diaSemanaUtc: 1=lunes .. 5=viernes).
			if (diaSemanaUtc >= 1 && diaSemanaUtc <= 5) {
				mensajes.push(msg(horaGtAEpoch(dia, 9), TRABAJO));
				mensajes.push(msg(horaGtAEpoch(dia, 12), TRABAJO));
				mensajes.push(msg(horaGtAEpoch(dia, 16), TRABAJO));
			}

			// Lugar recurrente: solo sábados, 3 horas.
			if (diaSemanaUtc === 6) {
				mensajes.push(msg(horaGtAEpoch(dia, 15), SABADOS));
				mensajes.push(msg(horaGtAEpoch(dia, 17), SABADOS));
			}

			// Ruido: una entrega ocasional que no debería aparecer como
			// ubicación clave (solo una vez, en un punto que nunca se repite).
			if (dia === 30) {
				mensajes.push(msg(horaGtAEpoch(dia, 13), { lat: 14.55, lon: -90.44 }));
				mensajes.push(
					msg(horaGtAEpoch(dia, 13) + 25 * 60, { lat: 14.55, lon: -90.44 }),
				);
			}
		}

		return mensajes;
	}

	const ubicaciones = calcularUbicacionesClave(generarHistorialSesentaDias());

	test("detecta la casa como probable_casa", () => {
		const casa = ubicaciones.find((u) => u.tipo === "probable_casa");
		expect(casa).toBeDefined();
		expect(casa?.lat).toBeCloseTo(CASA.lat, 3);
		expect(casa?.diasDistintos).toBeGreaterThanOrEqual(50);
	});

	test("detecta el trabajo como probable_trabajo", () => {
		const trabajo = ubicaciones.find((u) => u.tipo === "probable_trabajo");
		expect(trabajo).toBeDefined();
		expect(trabajo?.lat).toBeCloseTo(TRABAJO.lat, 3);
	});

	test("detecta el lugar de los sábados como recurrente", () => {
		const sabados = ubicaciones.find((u) => u.tipo === "recurrente");
		expect(sabados).toBeDefined();
		expect(sabados?.lat).toBeCloseTo(SABADOS.lat, 3);
	});

	test("la entrega aislada (ruido) no aparece como ubicación clave", () => {
		const ruido = ubicaciones.find(
			(u) => Math.abs(u.lat - 14.55) < 0.01 && Math.abs(u.lon - -90.44) < 0.01,
		);
		expect(ruido).toBeUndefined();
	});

	test("devuelve como máximo 5 ubicaciones, ordenadas por horas totales descendente", () => {
		expect(ubicaciones.length).toBeLessThanOrEqual(5);
		for (let i = 1; i < ubicaciones.length; i++) {
			expect(ubicaciones[i - 1]!.horasTotales).toBeGreaterThanOrEqual(
				ubicaciones[i]!.horasTotales,
			);
		}
	});
});

describe("calcularUbicacionesClave — sin historial", () => {
	test("arreglo vacío: no genera ubicaciones", () => {
		expect(calcularUbicacionesClave([])).toEqual([]);
	});
});

describe("calcularUbicacionesClave — ponderación por duración", () => {
	test("estancias nocturnas largas superan en peso a múltiples paradas cortas de fin de semana", () => {
		const mensajes: WialonMensajePosicion[] = [];
		// 5 noches de semana (días 5 a 9): estancia nocturna de 10 horas cada una en CASA (21:00 a 07:00)
		// y viaje a TRABAJO durante el día para separar las estancias
		for (let dia = 5; dia <= 9; dia++) {
			mensajes.push(msg(horaGtAEpoch(dia, 21), CASA));
			mensajes.push(msg(horaGtAEpoch(dia + 1, 7), CASA));
			mensajes.push(msg(horaGtAEpoch(dia + 1, 10), TRABAJO));
			mensajes.push(msg(horaGtAEpoch(dia + 1, 16), TRABAJO));
		}

		// Fin de semana (día 10 = sábado): 8 paradas cortas de 25 min en CASA,
		// intercaladas con viajes a otro punto para que no se fusionen
		for (let parada = 0; parada < 8; parada++) {
			const inicio = horaGtAEpoch(10, 8 + parada);
			mensajes.push(msg(inicio, CASA));
			mensajes.push(msg(inicio + 25 * 60, CASA));
			mensajes.push(msg(inicio + 35 * 60, TRABAJO));
		}

		const ubicaciones = calcularUbicacionesClave(mensajes);
		const casa = ubicaciones.find((u) => Math.abs(u.lat - CASA.lat) < 0.001);

		expect(casa).toBeDefined();
		// 5 visitas nocturnas de 10h = 50h vs 8 visitas cortas de fin de semana = ~3.3h
		// Con ponderación por visitas (5 vs 8), 5/13 = 38% (< 60%), fallaría.
		// Con ponderación por horas (50h vs ~3.3h), 50/53.3 = 93.8% (>= 60%), es probable_casa.
		expect(casa?.tipo).toBe("probable_casa");
		expect(casa?.patron.nocturna).toBeGreaterThanOrEqual(40);
		expect(casa?.patron.finDeSemana).toBeLessThan(10);
	});

	test("ubicación vespertina (18:00 a 23:00) no se clasifica como casa porque la mayoría de su tiempo no es nocturno", () => {
		const RESTAURANTE = { lat: 14.6, lon: -90.52 };
		const mensajes: WialonMensajePosicion[] = [];
		// 5 días de semana (días 5 a 9): estancia de 18:00 a 23:00 (5 horas cada día, solo 1 hora nocturna de 22:00 a 23:00)
		for (let dia = 5; dia <= 9; dia++) {
			mensajes.push(msg(horaGtAEpoch(dia, 18), RESTAURANTE));
			mensajes.push(msg(horaGtAEpoch(dia, 23), RESTAURANTE));
			// Separador de estancia
			mensajes.push(msg(horaGtAEpoch(dia + 1, 8), TRABAJO));
		}

		const ubicaciones = calcularUbicacionesClave(mensajes);
		const lugar = ubicaciones.find(
			(u) => Math.abs(u.lat - RESTAURANTE.lat) < 0.001,
		);

		expect(lugar).toBeDefined();
		// Total horas = 25h, nocturna = 5h (20%). Al incluir todo el tiempo de estancia, no es probable_casa.
		expect(lugar?.tipo).not.toBe("probable_casa");
		expect(lugar?.tipo).toBe("frecuente");
	});

	test("múltiples paradas en un solo sábado no se clasifican como recurrente sin al menos 3 semanas distintas", () => {
		const MANDADOS = { lat: 14.58, lon: -90.53 };
		const mensajes: WialonMensajePosicion[] = [];
		// Un solo sábado (día 10): 4 paradas de 30 minutos intercaladas
		for (let parada = 0; parada < 4; parada++) {
			const inicio = horaGtAEpoch(10, 9 + parada * 2);
			mensajes.push(msg(inicio, MANDADOS));
			mensajes.push(msg(inicio + 30 * 60, MANDADOS));
			mensajes.push(msg(inicio + 45 * 60, TRABAJO));
		}

		const ubicaciones = calcularUbicacionesClave(mensajes);
		const lugar = ubicaciones.find(
			(u) => Math.abs(u.lat - MANDADOS.lat) < 0.001,
		);

		expect(lugar).toBeDefined();
		// Aunque el 100% de visitas fue en sábado, solo hay 1 semana de evidencia (< 3).
		expect(lugar?.tipo).not.toBe("recurrente");
		expect(lugar?.tipo).toBe("frecuente");
	});

	test("visitas a un mismo lugar a lo largo de 3 semanas distintas en sábado sí se clasifican como recurrente", () => {
		const CLUB = { lat: 14.57, lon: -90.54 };
		const mensajes: WialonMensajePosicion[] = [];
		// 3 sábados consecutivos (día 10, 17, 24): 2 horas cada sábado
		for (const sabado of [10, 17, 24]) {
			mensajes.push(msg(horaGtAEpoch(sabado, 14), CLUB));
			mensajes.push(msg(horaGtAEpoch(sabado, 16), CLUB));
			mensajes.push(msg(horaGtAEpoch(sabado, 17), TRABAJO));
		}

		const ubicaciones = calcularUbicacionesClave(mensajes);
		const lugar = ubicaciones.find((u) => Math.abs(u.lat - CLUB.lat) < 0.001);

		expect(lugar).toBeDefined();
		expect(lugar?.tipo).toBe("recurrente");
	});
});

