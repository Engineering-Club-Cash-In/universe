/**
 * CB-119 (D-15) — Ubicaciones donde un vehículo pasa más tiempo, a partir de
 * su historial de posiciones (60 días, `messages/load_interval`). Reemplaza
 * el enfoque de "salida de geocerca" — el alcance real del ticket es
 * identificar dónde suele estar el vehículo (casa, trabajo, lugares
 * recurrentes) para orientar al equipo de recuperación cuando llega a B4.
 *
 * Todo este módulo es PURO (sin I/O): recibe mensajes ya traídos de Wialon,
 * devuelve ubicaciones clasificadas. El job (`jobs/gps-ubicaciones-clave.ts`)
 * hace el fetch y guarda el resultado.
 *
 * Pipeline: detectarEstancias → agruparEstancias → clasificar.
 */

import { distanciaMetros } from "./geo";
import type { WialonMensajePosicion } from "./wialon-types";

// Radio dentro del cual dos posiciones consecutivas cuentan como "el mismo
// lugar" al armar una estancia. Wialon reporta con GPS civil (~10-20m de
// error típico); 150m tolera ese ruido sin fusionar dos lugares distintos
// que estén a una cuadra de diferencia.
const RADIO_ESTANCIA_M = 150;

// Duración mínima para que un tramo cuente como estancia, no un semáforo o
// un embotellamiento. 20 min es corto para "casa" o "trabajo" (que duran
// horas) pero suficientemente largo para descartar paradas de tránsito.
const DURACION_MINIMA_ESTANCIA_MS = 20 * 60 * 1000;

// Velocidad bajo la cual se considera "detenido" — Wialon puede reportar
// pequeñas fluctuaciones de velocidad por ruido de GPS aunque el vehículo
// esté parado, así que no se exige exactamente 0.
const VELOCIDAD_DETENIDO_KMH = 5;

// Radio para agrupar estancias distintas en el mismo cluster/ubicación
// clave. Más grande que RADIO_ESTANCIA_M porque el vehículo no se detiene
// exactamente en el mismo punto GPS cada vez que visita "la casa" (puede
// estacionarse en distinto lugar de la cuadra).
const RADIO_CLUSTER_M = 200;

// Umbrales de ruido: una estancia aislada (ej. una entrega, un mandado) no
// debería aparecer como "ubicación clave" solo porque duró un rato una vez.
const MIN_VISITAS = 3;
const MIN_HORAS_TOTALES = 2;

// Offset fijo de Guatemala (UTC-6, sin horario de verano) — mismo criterio
// que ya usa services/wialon/gps-eventos.ts para la ventana de dedup.
const OFFSET_GUATEMALA_MS = 6 * 60 * 60 * 1000;

const MS_POR_HORA = 60 * 60 * 1000;

export interface Estancia {
	lat: number;
	lon: number;
	desde: Date;
	hasta: Date;
}

/**
 * Agrupa mensajes consecutivos en tramos donde el vehículo se quedó quieto
 * en el mismo lugar. Los huecos de tiempo SIN mensajes cuentan como parte de
 * la estadía si el vehículo seguía en el mismo punto al reanudar: un carro
 * estacionado de noche reporta pocos mensajes (o ninguno), y justamente esa
 * es la estancia más importante para detectar "casa".
 */
export function detectarEstancias(
	mensajes: WialonMensajePosicion[],
): Estancia[] {
	const ordenados = [...mensajes].sort((a, b) => a.t - b.t);
	const estancias: Estancia[] = [];

	let inicioTramo: WialonMensajePosicion | null = null;
	let ultimoDelTramo: WialonMensajePosicion | null = null;

	const cerrarTramo = () => {
		if (!inicioTramo || !ultimoDelTramo) return;
		const desde = new Date(inicioTramo.t * 1000);
		const hasta = new Date(ultimoDelTramo.t * 1000);
		if (hasta.getTime() - desde.getTime() >= DURACION_MINIMA_ESTANCIA_MS) {
			estancias.push({
				lat: inicioTramo.lat,
				lon: inicioTramo.lon,
				desde,
				hasta,
			});
		}
	};

	for (const msg of ordenados) {
		const detenido =
			msg.velocidadKmh == null || msg.velocidadKmh <= VELOCIDAD_DETENIDO_KMH;

		if (!detenido) {
			cerrarTramo();
			inicioTramo = null;
			ultimoDelTramo = null;
			continue;
		}

		if (!inicioTramo) {
			inicioTramo = msg;
			ultimoDelTramo = msg;
			continue;
		}

		const distancia = distanciaMetros(
			inicioTramo.lat,
			inicioTramo.lon,
			msg.lat,
			msg.lon,
		);
		if (distancia <= RADIO_ESTANCIA_M) {
			ultimoDelTramo = msg;
		} else {
			cerrarTramo();
			inicioTramo = msg;
			ultimoDelTramo = msg;
		}
	}
	cerrarTramo();

	return estancias;
}

interface FranjaHoraria {
	nocturna: number;
	laboral: number;
	finDeSemana: number;
}

export interface ClusterUbicacion {
	lat: number;
	lon: number;
	radioM: number;
	horasTotales: number;
	diasDistintos: number;
	visitas: number;
	primeraVisita: Date;
	ultimaVisita: Date;
	franjas: FranjaHoraria;
	// Visitas por día de la semana (0=domingo..6=sábado), para detectar
	// patrones tipo "todos los sábados" en clasificar().
	visitasPorDiaSemana: number[];
}

// Estado interno del cluster mientras se acumulan estancias — diasUnicos no
// forma parte del resultado público (ClusterUbicacion.diasDistintos es su
// tamaño final), solo existe para no recorrer las estancias dos veces.
interface ClusterEnConstruccion extends ClusterUbicacion {
	diasUnicos: Set<string>;
}

/**
 * Desglosa las horas de una estancia entre las franjas horarias analizadas:
 *  - nocturna: 22:00 a 06:00 (hora local de Guatemala), cualquier día.
 *  - finDeSemana: sábados y domingos en horario diurno (06:00 a 22:00).
 *  - laboral: lunes a viernes en horario laboral (08:00 a 18:00).
 *
 * Muestrea la estancia en pasos de 15 min para distribuir con precisión
 * estancias largas (ej. fin de semana completo o estadías nocturnas continuas)
 * entre sus franjas reales, en lugar de asignar todas las horas a una sola
 * franja por el punto medio.
 */
function desglosarHorasPorFranja(
	desde: Date,
	hasta: Date,
): { nocturna: number; laboral: number; finDeSemana: number } {
	let nocturna = 0;
	let laboral = 0;
	let finDeSemana = 0;

	const PASO_MS = 15 * 60 * 1000;
	const desdeMs = desde.getTime();
	const hastaMs = hasta.getTime();

	if (hastaMs <= desdeMs) {
		return { nocturna: 0, laboral: 0, finDeSemana: 0 };
	}

	for (let t = desdeMs; t < hastaMs; t += PASO_MS) {
		const duracionTramoMs = Math.min(PASO_MS, hastaMs - t);
		const duracionHoras = duracionTramoMs / MS_POR_HORA;

		const tMedio = t + duracionTramoMs / 2;
		const fechaGt = new Date(tMedio - OFFSET_GUATEMALA_MS);
		const horaDelDia = fechaGt.getUTCHours();
		const diaSemana = fechaGt.getUTCDay();
		const esFinDeSemana = diaSemana === 0 || diaSemana === 6;

		if (horaDelDia >= 22 || horaDelDia < 6) {
			nocturna += duracionHoras;
		} else if (esFinDeSemana) {
			finDeSemana += duracionHoras;
		} else if (horaDelDia >= 8 && horaDelDia < 18) {
			laboral += duracionHoras;
		}
	}

	return { nocturna, laboral, finDeSemana };
}

/**
 * Agrupa estancias cuyos centros están cerca entre sí (RADIO_CLUSTER_M) en
 * una sola ubicación clave, acumulando horas/días/visitas y la distribución
 * horaria que usa clasificar() para decidir el tipo.
 */
export function agruparEstancias(estancias: Estancia[]): ClusterUbicacion[] {
	const clusters: ClusterEnConstruccion[] = [];

	for (const estancia of estancias) {
		let cluster = clusters.find(
			(c) =>
				distanciaMetros(c.lat, c.lon, estancia.lat, estancia.lon) <=
				RADIO_CLUSTER_M,
		);

		if (!cluster) {
			cluster = {
				lat: estancia.lat,
				lon: estancia.lon,
				radioM: 0,
				horasTotales: 0,
				diasDistintos: 0,
				visitas: 0,
				primeraVisita: estancia.desde,
				ultimaVisita: estancia.hasta,
				franjas: { nocturna: 0, laboral: 0, finDeSemana: 0 },
				visitasPorDiaSemana: [0, 0, 0, 0, 0, 0, 0],
				diasUnicos: new Set(),
			};
			clusters.push(cluster);
		}

		const horasEstancia =
			(estancia.hasta.getTime() - estancia.desde.getTime()) / MS_POR_HORA;

		cluster.horasTotales += horasEstancia;
		cluster.visitas += 1;
		if (estancia.desde < cluster.primeraVisita) {
			cluster.primeraVisita = estancia.desde;
		}
		if (estancia.hasta > cluster.ultimaVisita) {
			cluster.ultimaVisita = estancia.hasta;
		}

		// Día de la semana y unicidad de días tomados del punto medio de la estancia
		const medioMs = (estancia.desde.getTime() + estancia.hasta.getTime()) / 2;
		const horaGt = new Date(medioMs - OFFSET_GUATEMALA_MS);
		const diaSemana = horaGt.getUTCDay();

		cluster.visitasPorDiaSemana[diaSemana] += 1;
		cluster.diasUnicos.add(horaGt.toISOString().slice(0, 10));

		// Se acumulan horasEstancia distribuidas por franja real para que visitas
		// cortas no distorsionen la clasificación de casa o trabajo frente a
		// estancias sustancialmente más largas.
		const franjas = desglosarHorasPorFranja(estancia.desde, estancia.hasta);
		cluster.franjas.nocturna += franjas.nocturna;
		cluster.franjas.laboral += franjas.laboral;
		cluster.franjas.finDeSemana += franjas.finDeSemana;
	}

	return clusters.map(({ diasUnicos, ...cluster }) => ({
		...cluster,
		diasDistintos: diasUnicos.size,
	}));
}

export type TipoUbicacionClave =
	| "probable_casa"
	| "probable_trabajo"
	| "recurrente"
	| "frecuente";

export interface UbicacionClaveClasificada {
	lat: number;
	lon: number;
	radioM: number;
	tipo: TipoUbicacionClave;
	horasTotales: number;
	diasDistintos: number;
	visitas: number;
	patron: FranjaHoraria & { visitasPorDiaSemana: number[] };
	primeraVisita: Date;
	ultimaVisita: Date;
}

/**
 * Clasifica un cluster ya agrupado según su distribución horaria:
 *  - probable_casa: mayoría nocturna, en muchos días distintos.
 *  - probable_trabajo: mayoría en horario laboral L-V, en muchos días.
 *  - recurrente: concentrado en un mismo día de la semana (ej. "sábados"),
 *    con al menos 3 semanas de evidencia.
 *  - frecuente: visitado seguido pero sin un patrón horario/día claro.
 */
export function clasificar(cluster: ClusterUbicacion): TipoUbicacionClave {
	const total =
		cluster.franjas.nocturna +
		cluster.franjas.laboral +
		cluster.franjas.finDeSemana;
	if (total === 0) return "frecuente";

	if (cluster.franjas.nocturna / total >= 0.6 && cluster.diasDistintos >= 5) {
		return "probable_casa";
	}

	if (cluster.franjas.laboral / total >= 0.6 && cluster.diasDistintos >= 5) {
		return "probable_trabajo";
	}

	const maxVisitasUnDia = Math.max(...cluster.visitasPorDiaSemana);
	if (maxVisitasUnDia >= 3 && maxVisitasUnDia / cluster.visitas >= 0.6) {
		return "recurrente";
	}

	return "frecuente";
}

/**
 * Pipeline completo: mensajes crudos → hasta 5 ubicaciones clave, ordenadas
 * por horas totales, descartando ruido (visitas/horas por debajo del
 * mínimo). No incluye la ventana de tiempo analizada (`ventanaDesde`/
 * `ventanaHasta`) porque es la misma para todas las filas de una corrida —
 * el job la agrega al armar las filas para insertar.
 */
export function calcularUbicacionesClave(
	mensajes: WialonMensajePosicion[],
): UbicacionClaveClasificada[] {
	const estancias = detectarEstancias(mensajes);
	const clusters = agruparEstancias(estancias);

	return clusters
		.filter(
			(c) => c.visitas >= MIN_VISITAS && c.horasTotales >= MIN_HORAS_TOTALES,
		)
		.map((cluster) => ({
			lat: cluster.lat,
			lon: cluster.lon,
			radioM: RADIO_CLUSTER_M,
			tipo: clasificar(cluster),
			horasTotales: cluster.horasTotales,
			diasDistintos: cluster.diasDistintos,
			visitas: cluster.visitas,
			patron: {
				...cluster.franjas,
				visitasPorDiaSemana: cluster.visitasPorDiaSemana,
			},
			primeraVisita: cluster.primeraVisita,
			ultimaVisita: cluster.ultimaVisita,
		}))
		.sort((a, b) => b.horasTotales - a.horasTotales)
		.slice(0, 5);
}
