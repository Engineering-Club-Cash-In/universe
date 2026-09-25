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

		// Franja horaria en hora de Guatemala, tomando el punto medio de la
		// estancia — una estancia larga que cruza medianoche igual cuenta como
		// una sola franja representativa, no se reparte hora por hora.
		const medioMs = (estancia.desde.getTime() + estancia.hasta.getTime()) / 2;
		const horaGt = new Date(medioMs - OFFSET_GUATEMALA_MS);
		const horaDelDia = horaGt.getUTCHours();
		const diaSemana = horaGt.getUTCDay();

		cluster.visitasPorDiaSemana[diaSemana] += 1;
		cluster.diasUnicos.add(horaGt.toISOString().slice(0, 10));
		const esFinDeSemana = diaSemana === 0 || diaSemana === 6;
		if (esFinDeSemana) {
			cluster.franjas.finDeSemana += 1;
		} else if (horaDelDia >= 22 || horaDelDia < 6) {
			cluster.franjas.nocturna += 1;
		} else if (horaDelDia >= 8 && horaDelDia < 18) {
			cluster.franjas.laboral += 1;
		}
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
