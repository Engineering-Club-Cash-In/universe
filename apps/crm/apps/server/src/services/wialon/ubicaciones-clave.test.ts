/**
 * CB-119 (D-15) — Algoritmo puro de "ubicaciones clave": detección de
 * estancias, clustering y clasificación. Sin I/O, todo con datos sintéticos.
 */
import { describe, expect, test } from "bun:test";
import {
	agruparEstancias,
	calcularUbicacionesClave,
	calcularUbicacionesClaveDeEstancias,
	detectarEstancias,
	detectarEstanciasConPendiente,
	diasCubiertos,
	nochesCubiertas,
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

describe("detectarEstanciasConPendiente", () => {
	const t0 = EPOCH_BASE;

	test("tramo en curso de menos de 20 min al final: sin estancia, queda como pendiente", () => {
		const r = detectarEstanciasConPendiente([
			msg(t0, CASA),
			msg(t0 + 12 * 60, CASA),
		]);

		expect(r.estancias).toHaveLength(0);
		expect(r.pendiente).toEqual({
			lat: CASA.lat,
			lon: CASA.lon,
			desde: new Date(t0 * 1000),
			hasta: new Date((t0 + 12 * 60) * 1000),
		});
	});

	test("tramo en curso que ya cumple 20 min: es estancia y no queda pendiente", () => {
		const r = detectarEstanciasConPendiente([
			msg(t0, CASA),
			msg(t0 + 30 * 60, CASA),
		]);

		expect(r.estancias).toHaveLength(1);
		expect(r.pendiente).toBeNull();
	});

	test("termina en movimiento: no hay pendiente", () => {
		const r = detectarEstanciasConPendiente([
			msg(t0, CASA),
			msg(t0 + 5 * 60, TRABAJO, 40),
		]);

		expect(r.pendiente).toBeNull();
	});

	test("una parada que cruza el cursor se recupera sembrando el pendiente", () => {
		const completo = [
			msg(t0, CASA),
			msg(t0 + 12 * 60, CASA),
			msg(t0 + 24 * 60, CASA),
		];
		// Corrida 1 termina en el cursor (12 min): ninguna mitad llega a 20 min.
		const primera = detectarEstanciasConPendiente(completo.slice(0, 2));
		expect(primera.estancias).toHaveLength(0);
		const p = primera.pendiente!;
		// Corrida 2: se siembra el pendiente y solo se piden los mensajes nuevos.
		const semilla = [
			msg(Math.floor(p.desde.getTime() / 1000), p),
			msg(Math.floor(p.hasta.getTime() / 1000), p),
		];
		const segunda = detectarEstanciasConPendiente([
			...semilla,
			...completo.slice(2),
		]);

		expect(segunda.estancias).toEqual(detectarEstancias(completo));
		expect(segunda.estancias).toHaveLength(1);
	});

	test("detectarEstancias devuelve lo mismo que antes (solo estancias)", () => {
		const mensajes = [msg(t0, CASA), msg(t0 + 30 * 60, CASA)];
		expect(detectarEstancias(mensajes)).toEqual(
			detectarEstanciasConPendiente(mensajes).estancias,
		);
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

// Fecha/hora de Guatemala relativa al 2026-07-01 00:00 GT.
function gt(diaOffset: number, horaGt: number): Date {
	return new Date(horaGtAEpoch(diaOffset, horaGt) * 1000);
}

function estancia(
	punto: { lat: number; lon: number },
	desde: Date,
	hasta: Date,
) {
	return { lat: punto.lat, lon: punto.lon, desde, hasta };
}

describe("nochesCubiertas", () => {
	test("una estancia de la tarde a la mañana siguiente cubre la noche que empezó esa tarde", () => {
		expect(nochesCubiertas(gt(0, 20), gt(1, 7))).toEqual(["2026-07-01"]);
	});

	test("una parada de 18:00 a 23:00 solo toca 1 h de la noche: no cuenta", () => {
		expect(nochesCubiertas(gt(0, 18), gt(0, 23))).toEqual([]);
	});

	test("el mínimo son 4 h dentro de 22:00–06:00", () => {
		expect(nochesCubiertas(gt(0, 22), gt(1, 1))).toEqual([]); // 3 h
		expect(nochesCubiertas(gt(0, 23), gt(1, 3))).toEqual(["2026-07-01"]); // 4 h
	});

	test("una estancia de varios días aporta todas sus noches", () => {
		expect(nochesCubiertas(gt(0, 12), gt(5, 12))).toEqual([
			"2026-07-01",
			"2026-07-02",
			"2026-07-03",
			"2026-07-04",
			"2026-07-05",
		]);
	});

	test("una estancia que empieza de madrugada cuenta la noche del día anterior", () => {
		expect(nochesCubiertas(gt(3, 1), gt(3, 9))).toEqual(["2026-07-03"]);
	});
});

describe("probable_casa por noches — carros que casi no se mueven", () => {
	const noEs = (tipo: string) => tipo !== "probable_casa";

	test("carro parado días seguidos en el mismo lugar: es probable_casa aunque solo el 33 % de sus horas sea nocturno", () => {
		// 10 estancias de ~46 h con huecos de 2 h entre ellas: ~20 noches.
		const estancias = Array.from({ length: 10 }, (_, i) =>
			estancia(CASA, gt(i * 2, 1), gt(i * 2 + 1, 23)),
		);
		const ubicaciones = calcularUbicacionesClaveDeEstancias(estancias);
		expect(ubicaciones).toHaveLength(1);
		const casa = ubicaciones[0];
		expect(casa?.tipo).toBe("probable_casa");
		expect(casa?.patron.nocturna / (casa?.horasTotales ?? 1)).toBeLessThan(0.5);
		expect(casa?.patron.noches).toBeGreaterThanOrEqual(18);
	});

	test("paradas de día en otro lugar no le quitan la casa", () => {
		const casa = Array.from({ length: 10 }, (_, i) =>
			estancia(CASA, gt(i * 2, 1), gt(i * 2 + 1, 23)),
		);
		const trabajo = [1, 3, 5].map((d) =>
			estancia(TRABAJO, gt(d, 10), gt(d, 11)),
		);
		const ubicaciones = calcularUbicacionesClaveDeEstancias([
			...casa,
			...trabajo,
		]);
		const tipoCasa = ubicaciones.find((u) => u.lat === CASA.lat);
		expect(tipoCasa?.tipo).toBe("probable_casa");
		const tipoTrabajo = ubicaciones.find((u) => u.lat === TRABAJO.lat);
		expect(tipoTrabajo?.tipo).toBeDefined();
		expect(noEs(tipoTrabajo?.tipo ?? "")).toBe(true);
	});

	test("dormir mitad y mitad en dos lugares: ninguno tiene la mayoría, no hay casa por noches", () => {
		const enCasa = Array.from({ length: 4 }, (_, i) =>
			estancia(CASA, gt(i * 2, 12), gt(i * 2 + 2, 11)),
		);
		const enOtro = Array.from({ length: 4 }, (_, i) =>
			estancia(SABADOS, gt(10 + i * 2, 12), gt(10 + i * 2 + 2, 11)),
		);
		const ubicaciones = calcularUbicacionesClaveDeEstancias([
			...enCasa,
			...enOtro,
		]);
		expect(ubicaciones.length).toBe(2);
		expect(ubicaciones.every((u) => noEs(u.tipo))).toBe(true);
	});

	test("menos de 5 noches no alcanza para casa", () => {
		// 3 estancias de un día completo: 3 noches en total.
		const estancias = [0, 2, 4].map((d) =>
			estancia(CASA, gt(d, 12), gt(d + 1, 12)),
		);
		const ubicaciones = calcularUbicacionesClaveDeEstancias(estancias);
		expect(ubicaciones).toHaveLength(1);
		expect(ubicaciones[0]?.tipo).not.toBe("probable_casa");
	});

	test("una ubicación que solo se visita de tarde (18:00–23:00) sigue sin ser casa", () => {
		const estancias = Array.from({ length: 12 }, (_, d) =>
			estancia(CASA, gt(d, 18), gt(d, 23)),
		);
		const ubicaciones = calcularUbicacionesClaveDeEstancias(estancias);
		expect(ubicaciones.every((u) => noEs(u.tipo))).toBe(true);
	});

	test("lo guarda en el patrón para poder mostrarlo", () => {
		const estancias = Array.from({ length: 10 }, (_, i) =>
			estancia(CASA, gt(i * 2, 1), gt(i * 2 + 1, 23)),
		);
		const [casa] = calcularUbicacionesClaveDeEstancias(estancias);
		expect(typeof casa?.patron.noches).toBe("number");
	});
});

describe("diasCubiertos y diasDistintos en estancias largas", () => {
	test("una estancia de varios días cubre cada fecha, no solo la del punto medio", () => {
		expect(diasCubiertos(gt(0, 12), gt(3, 12))).toEqual([
			"2026-07-01",
			"2026-07-02",
			"2026-07-03",
			"2026-07-04",
		]);
	});

	test("una estancia dentro de un mismo día cubre una sola fecha", () => {
		expect(diasCubiertos(gt(2, 9), gt(2, 17))).toEqual(["2026-07-03"]);
	});

	test("un carro parado seis días seguidos no cuenta como un solo día", () => {
		const estancias = [0, 6, 12].map((d) =>
			estancia(CASA, gt(d, 12), gt(d + 5, 12)),
		);
		const [casa] = calcularUbicacionesClaveDeEstancias(estancias);
		expect(casa?.diasDistintos).toBe(18);
	});
});

describe("una sola casa por unidad", () => {
	test("si dos lugares cumplen, gana el de más noches y el otro deja de ser casa", () => {
		// Los dos se visitan solo de noche (22:00–06:00): ambos son casa por la
		// regla del porcentaje nocturno.
		const principal = Array.from({ length: 10 }, (_, d) =>
			estancia(CASA, gt(d, 22), gt(d + 1, 6)),
		);
		const secundaria = Array.from({ length: 6 }, (_, d) =>
			estancia(SABADOS, gt(20 + d, 22), gt(21 + d, 6)),
		);
		const ubicaciones = calcularUbicacionesClaveDeEstancias([
			...principal,
			...secundaria,
		]);
		const casas = ubicaciones.filter((u) => u.tipo === "probable_casa");
		expect(casas).toHaveLength(1);
		expect(casas[0]?.lat).toBe(CASA.lat);
		const otra = ubicaciones.find((u) => u.lat === SABADOS.lat);
		expect(otra).toBeDefined();
		expect(otra?.tipo).not.toBe("probable_casa");
	});

	test("guarda cuántas noches hay en total para medir qué tan segura es la casa", () => {
		const estancias = Array.from({ length: 10 }, (_, i) =>
			estancia(CASA, gt(i * 2, 1), gt(i * 2 + 1, 23)),
		);
		const [casa] = calcularUbicacionesClaveDeEstancias(estancias);
		expect(casa?.patron.nochesTotales).toBe(casa?.patron.noches);
		expect(casa?.patron.nochesTotales).toBeGreaterThanOrEqual(18);
	});
});

describe("carros que casi no se mueven: pocas estancias muy largas", () => {
	test("una sola estancia de 45 días: es probable_casa aunque tenga 1 visita", () => {
		const ubicaciones = calcularUbicacionesClaveDeEstancias([
			estancia(CASA, gt(0, 12), gt(45, 12)),
		]);
		expect(ubicaciones).toHaveLength(1);
		expect(ubicaciones[0]?.tipo).toBe("probable_casa");
		expect(ubicaciones[0]?.visitas).toBe(1);
		expect(ubicaciones[0]?.patron.noches).toBe(45);
	});

	test("dos estancias largas (salió una vez y volvió): también es casa", () => {
		const ubicaciones = calcularUbicacionesClaveDeEstancias([
			estancia(CASA, gt(0, 12), gt(20, 9)),
			estancia(CASA, gt(20, 15), gt(40, 12)),
		]);
		expect(ubicaciones).toHaveLength(1);
		expect(ubicaciones[0]?.tipo).toBe("probable_casa");
	});

	test("una visita de pocas noches sigue siendo ruido: no aparece como ubicación", () => {
		// 8 noches en un solo lugar, pero hay otro con claramente más: el de
		// pocas visitas no es casa y no se lista como "frecuente".
		const ubicaciones = calcularUbicacionesClaveDeEstancias([
			estancia(CASA, gt(0, 12), gt(30, 12)),
			estancia(SABADOS, gt(31, 12), gt(39, 12)),
		]);
		expect(ubicaciones).toHaveLength(1);
		expect(ubicaciones[0]?.lat).toBe(CASA.lat);
	});

	test("un cluster de ruido con más noches y una sola visita no le quita la casa a la real si no la supera en noches", () => {
		// La casa duerme 20 noches en 5 visitas; el taller, 6 noches en 1 visita.
		const casa = Array.from({ length: 5 }, (_, i) =>
			estancia(CASA, gt(i * 5, 12), gt(i * 5 + 4, 12)),
		);
		const taller = estancia(SABADOS, gt(30, 12), gt(36, 12));
		const ubicaciones = calcularUbicacionesClaveDeEstancias([...casa, taller]);
		const tipos = Object.fromEntries(ubicaciones.map((u) => [u.lat, u.tipo]));
		expect(tipos[CASA.lat]).toBe("probable_casa");
		expect(tipos[SABADOS.lat]).toBeUndefined();
	});

	test("lo normal (3 o más visitas) no cambia: sigue entrando sin necesitar noches", () => {
		const estancias = [0, 2, 4].map((d) =>
			estancia(CASA, gt(d, 12), gt(d, 15)),
		);
		const ubicaciones = calcularUbicacionesClaveDeEstancias(estancias);
		expect(ubicaciones).toHaveLength(1);
		expect(ubicaciones[0]?.tipo).not.toBe("probable_casa");
	});
});
