/**
 * CB-119 — Detección de eventos GPS por polling (desconexión de energía,
 * ignición, GPS sin reportar) para créditos en B4 (mora exacta de 4 cuotas
 * — "Como Asesor B4 y Supervisor, quiero recibir alertas...", ticket
 * CB-119).
 *
 * Corre cada 5 minutos. No depende de que Wialon/La Legión configure nada
 * de su lado (webhook, notificación de recurso): primero le pregunta a
 * cartera-back qué SIFCOs están en B4 ahora mismo (`sifcosEnB4`), después
 * trae telemetría SOLO de las unidades vinculadas a esos casos, la compara
 * contra el último estado visto (`gps_unidad_estado`) y llama a
 * `registrarEventoGps` por cada transición.
 *
 * El bucket se pregunta en CADA corrida (no se asume que sigue en B4 desde
 * la corrida anterior): un crédito puede subir a B5 o bajar de B4 entre dos
 * corridas, y el universo del job tiene que reflejar eso.
 *
 * `gps_unidad_estado` es un snapshot, no historial: sin él, cada corrida
 * volvería a ver "ignición encendida" mientras el motor siga prendido y
 * generaría un evento (y una notificación, si no fuera por el dedup de
 * `registrarEventoGps`) cada 5 minutos. Comparando contra la corrida
 * anterior, solo se genera evento en la TRANSICIÓN.
 */

import { and, eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "../db";
import { casosCobros, contratosFinanciamiento } from "../db/schema/cobros";
import { opportunities } from "../db/schema/crm";
import { gpsEventos, gpsUnidadEstado } from "../db/schema/gps-eventos";
import { vehicles } from "../db/schema/vehicles";
import { fetchAllPages } from "../lib/fetch-all-pages";
import { carteraBackClient } from "../services/cartera-back-client";
import { isCarteraBackEnabled } from "../services/cartera-back-integration";
import { puntoDentroDePoligono } from "../services/wialon/geo";
import {
	type GpsEventoTipo,
	registrarEventoGps,
} from "../services/wialon/gps-eventos";
import { sanitizarPayloadWialon } from "../services/wialon/wialon-clasificacion";
import { getWialonClient } from "../services/wialon/wialon-client";
import { conContextoGps } from "../services/wialon/wialon-contexto";
import type { WialonTelemetriaUnidad } from "../services/wialon/wialon-types";

const LOG_PREFIX = "[GpsEventosPoll]";

// Retención de gps_eventos (historial visible en la Ficha 360, distinto de
// gps_integracion_logs de CB-121 que se purga a los 90 días).
const RETENCION_EVENTOS_MS = 180 * 24 * 60 * 60 * 1000;

// Umbral de "voltaje bajo" para considerar que la energía externa se
// desconectó. Wialon reporta pwr_ext en voltios; por debajo de esto es
// batería interna del equipo, no la del vehículo (mismo umbral que usaba la
// notificación "Desconexión de fuente" ya configurada por La Legión en su
// portal — ver spike de CB-119).
const UMBRAL_PWR_EXT_V = 3;

// Después de este tiempo sin mensaje nuevo, se considera que la unidad dejó
// de reportar (mismo corte que usa la Ficha 360 para "sin reportar", D-11
// del doc 09).
const UMBRAL_SIN_REPORTAR_MS = 2 * 60 * 60 * 1000;

// Recurso y geocerca "Perimetro cash" que ya existen en el portal de La
// Legión (confirmados en el spike de CB-119: recurso "CASH IN", zona 1 =
// polígono de Guatemala). Configurables porque cada ambiente (dev/prod)
// puede apuntar a una cuenta de Wialon distinta.
const WIALON_RESOURCE_ID = Number(process.env.WIALON_RESOURCE_ID ?? 28351747);
const WIALON_ZONA_PAIS_ID = Number(process.env.WIALON_ZONA_PAIS_ID ?? 1);

interface UnidadConCaso {
	wialonUnitId: number;
	/**
	 * SIFCO en B4 que hizo que esta unidad entrara al universo de la corrida.
	 * Se propaga hasta `registrarEventoGps` para que la resolución de caso
	 * quede acotada a ESTE caso — sin esto, una unidad vinculada a más de un
	 * vehículo/caso activo (reasignación, D-10) podía resolver contra el
	 * caso activo más reciente en vez del caso B4 que originó la detección.
	 */
	numeroCreditoSifco: string;
}

/**
 * SIFCOs en B4 (exactamente 4 cuotas de mora) según el motor de cartera-back
 * — no una aproximación local. El ticket (CB-119) es explícito: "Como
 * Asesor B4 y Supervisor, quiero recibir alertas...", así que el universo
 * del job es ese bucket, no "cualquier caso activo".
 *
 * `cuotas_min`/`cuotas_max` en 4 filtra del lado del servidor de
 * cartera-back (mismo parámetro que ya usa `sync-casos-cobros.ts` para
 * "aging" de cuotas). Se consultan los dos estados que agrupan crédito en
 * mora activa: MOROSO y EN_RECUPERACION (mismo par que usa
 * `sync-casos-cobros.ts`, COBROS-02 Fase 4 — un crédito en recuperación de
 * vehículo sigue siendo candidato a alerta GPS, con más razón).
 *
 * Si cartera-back no está habilitado o falla, se devuelve `null` (no `[]`):
 * el caller debe SALTAR la corrida entera, no interpretar un fallo de red
 * como "no hay créditos en B4 hoy".
 */
export async function sifcosEnB4(): Promise<string[] | null> {
	if (!isCarteraBackEnabled()) return null;

	// mes/anio en 0 desactiva el filtro de FECHA DE CREACIÓN del crédito en
	// cartera-back (apps/cartera-back/src/controllers/credits.ts): con el mes
	// actual, un crédito viejo en B4 (creado hace meses, como es lo normal en
	// mora avanzada) quedaba afuera — el filtro no es "reporte del mes", es
	// "creado en ese mes". El universo del job es "todo crédito en B4 ahora
	// mismo", sin importar cuándo se originó.
	const estadosEnMora = ["MOROSO", "EN_RECUPERACION"] as const;

	try {
		const porEstado = await Promise.all(
			estadosEnMora.map((estado) =>
				fetchAllPages(
					(page) =>
						carteraBackClient.getAllCreditos({
							mes: 0,
							anio: 0,
							estado,
							cuotas_min: 4,
							cuotas_max: 4,
							page,
							perPage: 1000,
						}),
					{ concurrency: 2 },
				),
			),
		);

		const sifcos = new Set<string>();
		for (const creditos of porEstado) {
			for (const c of creditos) {
				const sifco = c.creditos?.numero_credito_sifco;
				if (sifco) sifcos.add(sifco);
			}
		}
		return Array.from(sifcos);
	} catch (error) {
		console.error(
			`${LOG_PREFIX} Error obteniendo créditos B4 de cartera-back:`,
			error,
		);
		return null;
	}
}

/**
 * Unidades vinculadas a un caso de cobro ACTIVO cuyo `numeroCreditoSifco`
 * está en `sifcosB4`. Un caso llega a su vehículo por DOS caminos distintos
 * según el origen del crédito (mismo patrón dual que `routers/wialon.ts`
 * usa para la vinculación masiva, D-14 del plan CB-119):
 *  1. `casosCobros.contratoId → contratosFinanciamiento.vehicleId` — créditos
 *     que pasaron por el flujo de financiamiento del CRM.
 *  2. `opportunities.vehicleId` (cruzando por `numeroCreditoSifco`) — créditos
 *     que llegan por una oportunidad de venta, sin fila en
 *     `contratos_financiamiento`. Es el camino que usa
 *     `getDetallesCreditoCarteraBack` (routers/cobros.ts) para pintar la
 *     Ficha 360, y en la práctica es el que casi todos los casos usan.
 * `sifcosB4` ya viene sin prefijo `CRM-` (cartera-back nunca conoce esos
 * placeholders internos).
 */
export async function unidadesConCasoActivo(
	sifcosB4: string[],
): Promise<UnidadConCaso[]> {
	if (sifcosB4.length === 0) return [];

	const [porContrato, porOportunidad] = await Promise.all([
		db
			.selectDistinct({
				wialonUnitId: vehicles.wialonUnitId,
				numeroCreditoSifco: casosCobros.numeroCreditoSifco,
			})
			.from(vehicles)
			.innerJoin(
				contratosFinanciamiento,
				eq(contratosFinanciamiento.vehicleId, vehicles.id),
			)
			.innerJoin(
				casosCobros,
				eq(casosCobros.contratoId, contratosFinanciamiento.id),
			)
			.where(
				and(
					eq(casosCobros.activo, true),
					inArray(casosCobros.numeroCreditoSifco, sifcosB4),
				),
			),
		db
			.selectDistinct({
				wialonUnitId: vehicles.wialonUnitId,
				numeroCreditoSifco: casosCobros.numeroCreditoSifco,
			})
			.from(vehicles)
			.innerJoin(opportunities, eq(opportunities.vehicleId, vehicles.id))
			.innerJoin(
				casosCobros,
				eq(casosCobros.numeroCreditoSifco, opportunities.numeroSifco),
			)
			.where(
				and(
					eq(casosCobros.activo, true),
					inArray(opportunities.numeroSifco, sifcosB4),
				),
			),
	]);

	// Si la misma unidad aparece con más de un SIFCO B4 (varios vehículos
	// compartiendo unidad, cada uno con su propio caso en B4), se queda con
	// el primero visto — más adelante `resolverVehiculoYCaso` igual acota
	// contra ESE SIFCO puntual, no contra "cualquier caso activo de la
	// unidad", que es el bug que se corrige acá.
	const porUnidad = new Map<number, string>();
	for (const fila of [...porContrato, ...porOportunidad]) {
		if (fila.wialonUnitId == null || fila.numeroCreditoSifco == null) {
			continue;
		}
		if (!porUnidad.has(fila.wialonUnitId)) {
			porUnidad.set(fila.wialonUnitId, fila.numeroCreditoSifco);
		}
	}
	return Array.from(porUnidad, ([wialonUnitId, numeroCreditoSifco]) => ({
		wialonUnitId,
		numeroCreditoSifco,
	}));
}

/**
 * Valida que la geocerca traída de Wialon sea geométricamente apta para
 * evaluar punto-en-polígono, ANTES de confiar en su resultado. Sin esto,
 * una zona corrupta o vacía (0 puntos, o un tipo que no es polígono) haría
 * que `puntoDentroDePoligono` devuelva `false` para cualquier coordenada —
 * "está afuera" para TODA la flota a la vez, disparando una alerta masiva
 * falsa por un problema del proveedor, no del vehículo.
 */
export function esPoligonoValido(
	zona: { t: number; p: unknown } | null | undefined,
): zona is { t: number; p: { x: number; y: number }[] } {
	return zona?.t === 2 && Array.isArray(zona.p) && zona.p.length >= 3;
}

interface EventoDetectado {
	tipo: GpsEventoTipo;
	wialonUnitId: number;
	ocurridoAt: Date;
	lat?: number;
	lon?: number;
	velocidadKmh?: number;
	telemetria: WialonTelemetriaUnidad;
	numeroCreditoSifco: string;
}

/**
 * Compara la telemetría actual contra el snapshot anterior y decide qué
 * eventos generar. Pura (sin I/O) para poder testearla sin mockear DB/Wialon.
 */
export function detectarTransiciones(
	telemetria: WialonTelemetriaUnidad,
	anterior: {
		pwrExt: number | null;
		ignicionOn: boolean | null;
		sinReportarDesde: Date | null;
		dentroDeGeocerca: boolean | null;
	} | null,
	ahora: Date,
	// Ya evaluado (punto-en-polígono) por el caller: `null` = no se pudo
	// evaluar esta corrida (sin lat/lon, o la geocerca no se pudo leer de
	// Wialon) — en ese caso no se genera ni evalúa el evento, para no
	// confundir "no sabemos" con "está afuera".
	dentroDeGeocercaAhora: boolean | null = null,
	// SIFCO B4 que hizo entrar esta unidad al universo de la corrida — se
	// propaga hasta registrarEventoGps para acotar la resolución de caso.
	// Default solo para no romper los tests unitarios existentes de esta
	// función pura, que no ejercitan la resolución de caso; el caller real
	// (ejecutarDeteccionEventosGps) siempre lo pasa.
	numeroCreditoSifco = "",
): EventoDetectado[] {
	const eventos: EventoDetectado[] = [];
	const base = {
		wialonUnitId: telemetria.unitId,
		lat: telemetria.lat ?? undefined,
		lon: telemetria.lon ?? undefined,
		velocidadKmh: telemetria.velocidadKmh ?? undefined,
		telemetria,
		numeroCreditoSifco,
	};

	// Energía: transición de "con energía o desconocido" a "sin energía".
	if (
		telemetria.pwrExt != null &&
		telemetria.pwrExt < UMBRAL_PWR_EXT_V &&
		(anterior?.pwrExt == null || anterior.pwrExt >= UMBRAL_PWR_EXT_V)
	) {
		eventos.push({
			...base,
			tipo: "desconexion_energia",
			ocurridoAt: telemetria.ultimoMensajeAt ?? ahora,
		});
	}

	// Ignición: transición de apagado/desconocido a encendido.
	if (telemetria.ignicionOn === true && anterior?.ignicionOn !== true) {
		eventos.push({
			...base,
			tipo: "ignicion",
			ocurridoAt: telemetria.ultimoMensajeAt ?? ahora,
		});
	}

	// Sin reportar: la última señal es más vieja que el umbral. Se dispara
	// en la corrida en la que se CRUZA el umbral (anterior.sinReportarDesde
	// era null), no en cada corrida mientras se mantenga caída — el dedup de
	// 6h de registrarEventoGps ya cubriría eso, pero evita generar filas de
	// gps_eventos de más.
	const ultimaSenal = telemetria.ultimoMensajeAt;
	const sinReportarAhora =
		!ultimaSenal ||
		ahora.getTime() - ultimaSenal.getTime() >= UMBRAL_SIN_REPORTAR_MS;
	if (sinReportarAhora && !anterior?.sinReportarDesde) {
		eventos.push({
			...base,
			tipo: "sin_reportar",
			ocurridoAt: ahora,
		});
	}

	// Geocerca: transición de "dentro o desconocido" a "fuera". Solo si esta
	// corrida SÍ pudo evaluarse (dentroDeGeocercaAhora !== null) — con la
	// geocerca sin leer, no hay forma de distinguir un cruce real de un
	// simple fallo de la API.
	if (dentroDeGeocercaAhora === false && anterior?.dentroDeGeocerca !== false) {
		eventos.push({
			...base,
			tipo: "salida_geocerca",
			ocurridoAt: telemetria.ultimoMensajeAt ?? ahora,
		});
	}

	return eventos;
}

export async function ejecutarDeteccionEventosGps(): Promise<{
	unidadesConsultadas: number;
	eventosDetectados: number;
	eventosNotificados: number;
}> {
	const sifcosB4 = await sifcosEnB4();
	// null = cartera-back deshabilitado o falló: se salta esta corrida entera
	// en vez de tratarlo como "0 créditos en B4 hoy" (que dispararía 0
	// consultas silenciosamente cada 5 min sin que nadie se entere del fallo
	// real, ya que este job no pasa por gps_integracion_logs de CB-121).
	if (sifcosB4 === null) {
		console.warn(
			`${LOG_PREFIX} Se saltó la corrida: no se pudo obtener el universo B4 de cartera-back`,
		);
		return {
			unidadesConsultadas: 0,
			eventosDetectados: 0,
			eventosNotificados: 0,
		};
	}

	const unidades = await unidadesConCasoActivo(sifcosB4);
	if (unidades.length === 0) {
		return {
			unidadesConsultadas: 0,
			eventosDetectados: 0,
			eventosNotificados: 0,
		};
	}

	const unitIds = unidades.map((u) => u.wialonUnitId);
	const sifcoPorUnidad = new Map(
		unidades.map((u) => [u.wialonUnitId, u.numeroCreditoSifco]),
	);

	const [telemetrias, poligonoPais] = await conContextoGps(
		{ origen: "gps-eventos-poll" },
		async () => {
			const cliente = getWialonClient();
			// En paralelo: la geocerca no depende de las unidades. Si falla
			// (spike de CB-119: puede devolver null si la zona no existe o
			// cambió de id), el error NO debe tumbar la telemetría del resto de
			// eventos — se degrada a "no evaluar geocerca esta corrida".
			const [telemetriasResult, poligonoResult] = await Promise.allSettled([
				cliente.getTelemetriaUnidades(unitIds),
				cliente.getZonaPoligono(WIALON_RESOURCE_ID, WIALON_ZONA_PAIS_ID),
			]);

			if (telemetriasResult.status === "rejected") {
				throw telemetriasResult.reason;
			}
			if (poligonoResult.status === "rejected") {
				console.error(
					`${LOG_PREFIX} No se pudo leer la geocerca "Perimetro cash":`,
					poligonoResult.reason,
				);
			}

			return [
				telemetriasResult.value,
				poligonoResult.status === "fulfilled" ? poligonoResult.value : null,
			] as const;
		},
	);

	const snapshotsPrevios = await db
		.select()
		.from(gpsUnidadEstado)
		.where(inArray(gpsUnidadEstado.wialonUnitId, unitIds));
	const snapshotPorId = new Map(
		snapshotsPrevios.map((s) => [s.wialonUnitId, s]),
	);

	// Se calcula UNA vez por corrida, no por unidad dentro del loop.
	const poligonoValido = esPoligonoValido(poligonoPais);

	const ahora = new Date();
	let eventosDetectados = 0;
	let eventosNotificados = 0;

	// Filas de snapshot acumuladas para UN SOLO upsert batch al final del
	// loop (en vez de un insert por unidad): con 25-70 unidades en B4 real,
	// un round-trip por unidad solo para el snapshot sumaba latencia de red
	// innecesaria en cada corrida.
	const snapshotsParaGuardar: (typeof gpsUnidadEstado.$inferInsert)[] = [];

	for (const telemetria of telemetrias) {
		const anterior = snapshotPorId.get(telemetria.unitId) ?? null;

		// null si no hay geocerca válida, coordenadas no finitas (incluye NaN:
		// `NaN != null` es `true` en JS, así que un check contra `null` a
		// secas no lo filtraba) o no se pudo leer la geocerca esta corrida —
		// detectarTransiciones lo trata como "no evaluar", no como "está afuera".
		const tieneCoordenadas =
			Number.isFinite(telemetria.lat) && Number.isFinite(telemetria.lon);
		const dentroDeGeocercaAhora =
			poligonoValido && tieneCoordenadas
				? puntoDentroDePoligono(
						telemetria.lat as number,
						telemetria.lon as number,
						(poligonoPais as NonNullable<typeof poligonoPais>).p,
					)
				: null;

		const eventos = detectarTransiciones(
			telemetria,
			anterior
				? {
						pwrExt: anterior.pwrExt,
						ignicionOn: anterior.ignicionOn,
						sinReportarDesde: anterior.sinReportarDesde,
						dentroDeGeocerca: anterior.dentroDeGeocerca,
					}
				: null,
			ahora,
			dentroDeGeocercaAhora,
			// unitIds viene de unidades (unidadesConCasoActivo), así que siempre
			// hay un SIFCO mapeado para cada telemetria.unitId de esta corrida.
			sifcoPorUnidad.get(telemetria.unitId) ?? "",
		);

		// Si algún evento de esta unidad falla al registrarse, el snapshot de
		// la unidad NO se guarda esta corrida: si se guardara igual, la
		// próxima corrida compararía contra el estado ya "avanzado" y la
		// transición fallida jamás se volvería a detectar ni reintentar.
		let huboFalloEnUnidad = false;

		for (const evento of eventos) {
			eventosDetectados++;
			try {
				const resultado = await registrarEventoGps({
					tipo: evento.tipo,
					wialonUnitId: evento.wialonUnitId,
					ocurridoAt: evento.ocurridoAt,
					lat: evento.lat,
					lon: evento.lon,
					velocidadKmh: evento.velocidadKmh,
					payloadCrudo: sanitizarPayloadWialon(evento.telemetria),
					numeroCreditoSifcoEsperado: evento.numeroCreditoSifco || undefined,
				});
				if (resultado.notificado) eventosNotificados++;
			} catch (error) {
				huboFalloEnUnidad = true;
				console.error(
					`${LOG_PREFIX} Error registrando evento ${evento.tipo} de la unidad ${evento.wialonUnitId}:`,
					error,
				);
			}
		}

		if (huboFalloEnUnidad) continue;

		const ultimaSenal = telemetria.ultimoMensajeAt;
		const sinReportarAhora =
			!ultimaSenal ||
			ahora.getTime() - ultimaSenal.getTime() >= UMBRAL_SIN_REPORTAR_MS;

		// Si esta corrida no pudo evaluar geocerca (null), se conserva el
		// último valor conocido en vez de pisarlo — perderlo haría que la
		// PRÓXIMA corrida que sí pueda evaluar trate cualquier resultado como
		// una "transición" aunque no lo sea.
		const dentroDeGeocercaGuardar =
			dentroDeGeocercaAhora ?? anterior?.dentroDeGeocerca ?? null;

		snapshotsParaGuardar.push({
			wialonUnitId: telemetria.unitId,
			pwrExt: telemetria.pwrExt,
			ignicionOn: telemetria.ignicionOn,
			ultimaSenalWialon: ultimaSenal,
			sinReportarDesde: sinReportarAhora
				? (anterior?.sinReportarDesde ?? ahora)
				: null,
			dentroDeGeocerca: dentroDeGeocercaGuardar,
			actualizadoAt: ahora,
		});
	}

	if (snapshotsParaGuardar.length > 0) {
		await db
			.insert(gpsUnidadEstado)
			.values(snapshotsParaGuardar)
			.onConflictDoUpdate({
				target: gpsUnidadEstado.wialonUnitId,
				set: {
					pwrExt: sql`excluded.pwr_ext`,
					ignicionOn: sql`excluded.ignicion_on`,
					ultimaSenalWialon: sql`excluded.ultima_señal_wialon`,
					sinReportarDesde: sql`excluded.sin_reportar_desde`,
					dentroDeGeocerca: sql`excluded.dentro_de_geocerca`,
					actualizadoAt: sql`excluded.actualizado_at`,
				},
			});
	}

	return {
		unidadesConsultadas: telemetrias.length,
		eventosDetectados,
		eventosNotificados,
	};
}

// Guarda de ejecución en memoria: si una corrida se demora más que el
// intervalo del setInterval (5 min) — cartera-back lento paginando, Wialon
// con reintentos/backoff — el siguiente tick arrancaría en paralelo con la
// corrida anterior, y ambas leerían/escribirían gps_unidad_estado a la vez
// para las mismas unidades. Por instancia del proceso, mismo criterio que el
// circuit breaker del WialonClient (D-13).
let corridaEnCurso = false;

export async function correrDeteccionEventosGps(): Promise<void> {
	if (corridaEnCurso) {
		console.warn(
			`${LOG_PREFIX} Corrida anterior aún en curso, se salta este tick`,
		);
		return;
	}
	corridaEnCurso = true;
	try {
		const resultado = await ejecutarDeteccionEventosGps();
		if (resultado.eventosDetectados > 0) {
			console.log(
				`${LOG_PREFIX} ${resultado.unidadesConsultadas} unidades · ${resultado.eventosDetectados} eventos · ${resultado.eventosNotificados} notificados`,
			);
		}
	} catch (error) {
		console.error(`${LOG_PREFIX} Error en la corrida:`, error);
	} finally {
		corridaEnCurso = false;
	}
}

/**
 * Purga gps_eventos > 180 días (retención documentada en D-14, mismo
 * patrón que correrPurgaGpsIntegracionLogs de CB-121). Sin esto la tabla
 * crece sin límite — el índice idx_gps_eventos_recibido_at existe
 * justamente para soportar este borrado.
 */
export async function purgarGpsEventos(): Promise<number> {
	const limite = new Date(Date.now() - RETENCION_EVENTOS_MS);
	const borradas = await db
		.delete(gpsEventos)
		.where(lt(gpsEventos.recibidoAt, limite))
		.returning({ id: gpsEventos.id });
	return borradas.length;
}

export async function correrPurgaGpsEventos(): Promise<void> {
	try {
		const borradas = await purgarGpsEventos();
		if (borradas > 0) {
			console.log(`${LOG_PREFIX} Purgadas ${borradas} filas > 180 días`);
		}
	} catch (error) {
		console.error(`${LOG_PREFIX} Error en la purga de gps_eventos:`, error);
	}
}
