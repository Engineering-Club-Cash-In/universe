/**
 * CB-119 (D-15) — Cálculo nocturno de "ubicaciones clave" (casa, trabajo,
 * lugares recurrentes) para vehículos con caso de cobro activo, en cualquier
 * bucket, a partir del historial de posiciones de Wialon de los últimos 60
 * días.
 *
 * Reemplaza el enfoque de "salida de geocerca" (D-14, retirado): el alcance
 * real de la historia es identificar dónde suele estar el vehículo para
 * orientar al equipo de recuperación, no detectar un cruce de frontera.
 *
 * Incremental: bajar 60 días de mensajes crudos por unidad cada noche (9
 * tramos de 7 días, load + unload cada uno) no escala a todos los vehículos.
 * Lo único que necesita el cálculo de los mensajes son las ESTANCIAS (primer
 * paso del pipeline), así que se guardan en `gps_estancias` y cada noche se
 * pide a Wialon solo lo posterior al último punto procesado
 * (`gps_estancias_cursor`): normalmente 1 tramo. El agrupado y la
 * clasificación corren sobre las estancias guardadas, sin tocar Wialon.
 *
 * La última estancia guardada se siembra al detector en lugar de re-pedir su
 * historial, para que un carro estacionado días no obligue a bajar esos días.
 *
 * Una unidad sin cursor (nunca procesada, o con el cursor fuera de la
 * ventana) necesita el backfill completo de 60 días; se limita a
 * `BACKFILL_MAX_POR_CORRIDA` por corrida para repartir ese costo en varias
 * noches. Mientras espera conserva el snapshot que ya tuviera.
 *
 * Snapshot, no acumulativo: cada corrida REEMPLAZA las filas de cada
 * (unidad, SIFCO) en `gps_ubicaciones_clave`, sobre la ventana completa de
 * 60 días — no se van sumando corridas viejas.
 */

import {
	and,
	desc,
	eq,
	gte,
	isNull,
	lt,
	not,
	notInArray,
	or,
	sql,
} from "drizzle-orm";
import { db } from "../db";
import { gpsConsultaLogs } from "../db/schema/gps-consulta-logs";
import {
	gpsEstancias,
	gpsEstanciasCursor,
	gpsUbicacionesClave,
} from "../db/schema/gps-eventos";
import { resolverVehiculoYCaso } from "../services/wialon/gps-eventos";
import { purgarSnapshotsUbicacionesClave } from "../services/wialon/purgar-snapshots-ubicaciones";
import {
	calcularUbicacionesClaveDeEstancias,
	detectarEstanciasConPendiente,
	type Estancia,
} from "../services/wialon/ubicaciones-clave";
import { getWialonClient } from "../services/wialon/wialon-client";
import { conContextoGps } from "../services/wialon/wialon-contexto";
import type { WialonMensajePosicion } from "../services/wialon/wialon-types";
import { sifcosEnB4, unidadesConCasoActivo } from "./gps-eventos-poll";

const LOG_PREFIX = "[GpsUbicacionesClave]";

// Ventana de historial a analizar — confirmada en el spike de D-15 contra
// la retención real de la cuenta de Wialon (ver docs/features/cobros-02).
const VENTANA_DIAS = 60;
const MS_POR_DIA = 24 * 60 * 60 * 1000;

// Cuántas unidades pueden hacer el backfill completo (9 tramos) en una misma
// corrida. Repartir el costo inicial: con todos los vehículos, bajar 60 días
// de todos a la vez no cabe en una noche.
const BACKFILL_MAX_POR_CORRIDA = 100;

/**
 * Segunda mitad del cálculo, sin tocar Wialon: lee las estancias guardadas de
 * la unidad (últimos 60 días), calcula las ubicaciones clave y reemplaza las de
 * cada SIFCO. Lo usan el cálculo normal y el bajo demanda cuando la unidad ya
 * se calculó hace poco (varios créditos pueden compartir la unidad).
 */
async function guardarUbicacionesDeUnidad({
	wialonUnitId,
	sifcos,
	ahora,
	ventanaDesde,
}: {
	wialonUnitId: number;
	sifcos: string[];
	ahora: Date;
	ventanaDesde: Date;
}): Promise<number> {
	const guardadas = await db
		.select({
			lat: gpsEstancias.lat,
			lon: gpsEstancias.lon,
			desde: gpsEstancias.desde,
			hasta: gpsEstancias.hasta,
		})
		.from(gpsEstancias)
		.where(
			and(
				eq(gpsEstancias.wialonUnitId, wialonUnitId),
				gte(gpsEstancias.hasta, ventanaDesde),
			),
		);
	// Una estancia que cruza el borde de la ventana cuenta solo desde el
	// borde, igual que cuando el cálculo partía de los mensajes de 60 días.
	const estancias: Estancia[] = guardadas.map((e) => ({
		...e,
		desde: e.desde < ventanaDesde ? ventanaDesde : e.desde,
	}));
	const ubicaciones = calcularUbicacionesClaveDeEstancias(estancias);

	for (const numeroCreditoSifco of sifcos) {
		const { vehicleId, casoCobroId } = await resolverVehiculoYCaso(
			wialonUnitId,
			numeroCreditoSifco,
		);

		// Reemplazo transaccional: se borran las filas viejas de este
		// (unidad, SIFCO) y de este caso (si existe) para no dejar huérfanos
		// si la unidad o el vehículo cambiaron de vínculo, y se insertan las
		// nuevas juntas — un observador nunca ve un estado intermedio "sin
		// ubicaciones" para una unidad que sí las tenía calculadas.
		await db.transaction(async (tx) => {
			await bloquearUnidad(tx, wialonUnitId);
			const condicionesBorrado = [
				and(
					eq(gpsUbicacionesClave.wialonUnitId, wialonUnitId),
					eq(gpsUbicacionesClave.numeroCreditoSifco, numeroCreditoSifco),
				),
			];
			if (casoCobroId) {
				condicionesBorrado.push(
					eq(gpsUbicacionesClave.casoCobroId, casoCobroId),
				);
			}

			await tx
				.delete(gpsUbicacionesClave)
				.where(
					condicionesBorrado.length > 1
						? or(...condicionesBorrado)
						: condicionesBorrado[0]!,
				);

			if (ubicaciones.length > 0) {
				await tx.insert(gpsUbicacionesClave).values(
					ubicaciones.map((u) => ({
						wialonUnitId,
						numeroCreditoSifco,
						vehicleId,
						casoCobroId,
						lat: u.lat,
						lon: u.lon,
						radioM: u.radioM,
						tipo: u.tipo,
						horasTotales: u.horasTotales,
						diasDistintos: u.diasDistintos,
						visitas: u.visitas,
						patron: u.patron,
						primeraVisita: u.primeraVisita,
						ultimaVisita: u.ultimaVisita,
						ventanaDesde,
						ventanaHasta: ahora,
						calculadoAt: ahora,
					})),
				);
			}
		});
	}
	return ubicaciones.length;
}

/**
 * Procesa UNA unidad: pide a Wialon lo que falta, actualiza sus estancias y
 * su cursor, y reemplaza las ubicaciones clave de cada SIFCO. Lo usan el job
 * nocturno y el botón "Calcular ahora" de la ficha.
 *
 * Una misma unidad no se procesa dos veces a la vez (job + botón, o dos
 * clics): dos corridas simultáneas borrarían y volverían a insertar las
 * mismas estancias. La guarda es en memoria, mismo supuesto de una sola
 * instancia que `corridaEnCurso`.
 */
const unidadesEnProceso = new Set<number>();

/**
 * Estado de procesamiento de una unidad. `ultimoMensajeAt` es el último
 * mensaje de posición que se leyó de Wialon (null si aún no se ha leído
 * ninguno, o si el cursor es anterior a esta columna): sirve para saber si la
 * última estancia guardada quedó abierta (ver `calcularUbicacionesUnidad`).
 */
export interface CursorUnidad {
	procesadoHasta: Date;
	ultimoMensajeAt: Date | null;
	// Tramo en curso (<20 min) al terminar la última corrida: no es estancia
	// guardada todavía, pero la parada puede completarse con lo siguiente.
	pendiente: Estancia | null;
}

function aCursorUnidad(fila: {
	procesadoHasta: Date;
	ultimoMensajeAt: Date | null;
	pendienteLat: number | null;
	pendienteLon: number | null;
	pendienteDesde: Date | null;
	pendienteHasta: Date | null;
}): CursorUnidad {
	const pendiente =
		fila.pendienteLat != null &&
		fila.pendienteLon != null &&
		fila.pendienteDesde != null &&
		fila.pendienteHasta != null
			? {
					lat: fila.pendienteLat,
					lon: fila.pendienteLon,
					desde: fila.pendienteDesde,
					hasta: fila.pendienteHasta,
				}
			: null;
	return {
		procesadoHasta: fila.procesadoHasta,
		ultimoMensajeAt: fila.ultimoMensajeAt,
		pendiente,
	};
}

// Serializa, entre instancias del servidor, todo lo que escribe sobre una
// unidad. Dentro de la misma transacción que borra y reinserta, así que dos
// escrituras simultáneas se ordenan en vez de duplicar filas.
async function bloquearUnidad(
	tx: Pick<typeof db, "execute">,
	wialonUnitId: number,
) {
	await tx.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${`gps_unidad:${wialonUnitId}`}, 0))`,
	);
}

export async function calcularUbicacionesUnidad({
	wialonUnitId,
	sifcos,
	cursor,
	ahora,
	ventanaDesde,
}: {
	wialonUnitId: number;
	sifcos: string[];
	// Estado de la unidad. undefined = nunca procesada (backfill).
	cursor: CursorUnidad | undefined;
	ahora: Date;
	ventanaDesde: Date;
}): Promise<
	| { estado: "ok"; ubicaciones: number; backfill: boolean }
	| { estado: "incompleto" }
	| { estado: "en_proceso" }
> {
	if (unidadesEnProceso.has(wialonUnitId)) return { estado: "en_proceso" };
	unidadesEnProceso.add(wialonUnitId);
	try {
		const requiereBackfill = !cursor || cursor.procesadoHasta < ventanaDesde;
		const pedirDesde = requiereBackfill ? ventanaDesde : cursor.procesadoHasta;

		// La última estancia guardada pudo quedar abierta (carro estacionado
		// que sigue ahí). En vez de volver a pedir su historial —un carro
		// parado una semana serían 7 días de mensajes— se siembra al detector
		// con dos mensajes (su inicio y su fin, detenido): si los mensajes
		// nuevos siguen en el mismo punto la estancia se extiende, y si se
		// movió se cierra tal cual. Se reemplaza esa estancia, no se duplica.
		//
		// Solo se siembra si de verdad quedó abierta: su último mensaje es el
		// último que se leyó (`ultimoMensajeAt`). Si después hubo movimiento, o
		// el carro se fue y volvió, esos mensajes ya se consumieron en corridas
		// anteriores y la semilla no los vería: fusionaría la estancia vieja con
		// la visita de hoy en una sola de días. Sin `ultimoMensajeAt` (cursor
		// anterior a la columna) no se siembra: a lo sumo se parte una estancia.
		let semilla: WialonMensajePosicion[] = [];
		let borrarDesde: Date | null = null;
		if (!requiereBackfill) {
			const [ultima] = await db
				.select({
					lat: gpsEstancias.lat,
					lon: gpsEstancias.lon,
					desde: gpsEstancias.desde,
					hasta: gpsEstancias.hasta,
				})
				.from(gpsEstancias)
				.where(eq(gpsEstancias.wialonUnitId, wialonUnitId))
				.orderBy(desc(gpsEstancias.desde))
				.limit(1);
			const segundos = (d: Date) => Math.floor(d.getTime() / 1000);
			const abierta =
				ultima &&
				cursor.ultimoMensajeAt != null &&
				segundos(ultima.hasta) === segundos(cursor.ultimoMensajeAt);
			if (ultima && abierta) {
				const punto = { lat: ultima.lat, lon: ultima.lon, velocidadKmh: 0 };
				semilla = [
					{ ...punto, t: segundos(ultima.desde) },
					{ ...punto, t: segundos(ultima.hasta) },
				];
				borrarDesde = ultima.desde;
			} else {
				borrarDesde = cursor.procesadoHasta;
				// Sin estancia abierta, pudo quedar un tramo en curso de menos de 20
				// min. Si la parada se completa con lo nuevo, juntos sí cumplen el
				// mínimo; sin sembrarlo, esa parada se perdía.
				if (cursor.pendiente) {
					const punto = {
						lat: cursor.pendiente.lat,
						lon: cursor.pendiente.lon,
						velocidadKmh: 0,
					};
					semilla = [
						{ ...punto, t: segundos(cursor.pendiente.desde) },
						{ ...punto, t: segundos(cursor.pendiente.hasta) },
					];
				}
			}
		}

		const historial = await conContextoGps(
			{ origen: "gps-ubicaciones-clave" },
			() =>
				getWialonClient().getHistorialPosiciones(
					wialonUnitId,
					pedirDesde,
					ahora,
				),
		);

		if (!historial.completo) {
			console.warn(
				`${LOG_PREFIX} No se pudo obtener el historial completo de la unidad ${wialonUnitId}: ${historial.tramosCompletados}/${historial.tramosTotal} tramos completados. Se preserva el snapshot previo y el cursor no avanza.`,
			);
			return { estado: "incompleto" };
		}

		// Reemplazo transaccional de lo recalculado: las estancias desde
		// `pedirDesde` salen y entran las nuevas, y el cursor avanza junto —
		// un fallo a medias no deja el cursor adelantado sin sus estancias.
		const { estancias: nuevas, pendiente } = detectarEstanciasConPendiente([
			...semilla,
			...historial.mensajes,
		]);
		// Si no llegaron mensajes, el último que se leyó sigue siendo el anterior.
		const ultimoNuevo = historial.mensajes.reduce(
			(max, m) => Math.max(max, m.t),
			0,
		);
		const ultimoMensajeAt =
			ultimoNuevo > 0
				? new Date(ultimoNuevo * 1000)
				: (cursor?.ultimoMensajeAt ?? null);
		const aplicado = await db.transaction(async (tx) => {
			await bloquearUnidad(tx, wialonUnitId);

			// Con el lock tomado, se revalida que el cursor siga siendo el que se
			// leyó antes de pedir a Wialon. Si otra instancia procesó la unidad en
			// el medio, esta corrida quedó vieja: escribir movería el cursor hacia
			// atrás y borraría estancias más nuevas. Se descarta sin escribir.
			const [actual] = await tx
				.select({ procesadoHasta: gpsEstanciasCursor.procesadoHasta })
				.from(gpsEstanciasCursor)
				.where(eq(gpsEstanciasCursor.wialonUnitId, wialonUnitId))
				.limit(1);
			if (
				(actual?.procesadoHasta.getTime() ?? null) !==
				(cursor?.procesadoHasta.getTime() ?? null)
			) {
				return false;
			}

			await tx
				.delete(gpsEstancias)
				.where(
					and(
						eq(gpsEstancias.wialonUnitId, wialonUnitId),
						borrarDesde ? gte(gpsEstancias.desde, borrarDesde) : undefined,
					),
				);
			if (nuevas.length > 0) {
				await tx.insert(gpsEstancias).values(
					nuevas.map((e) => ({
						wialonUnitId,
						lat: e.lat,
						lon: e.lon,
						desde: e.desde,
						hasta: e.hasta,
					})),
				);
			}
			const cursorNuevo = {
				procesadoHasta: ahora,
				ultimoMensajeAt,
				pendienteLat: pendiente?.lat ?? null,
				pendienteLon: pendiente?.lon ?? null,
				pendienteDesde: pendiente?.desde ?? null,
				pendienteHasta: pendiente?.hasta ?? null,
			};
			await tx
				.insert(gpsEstanciasCursor)
				.values({ wialonUnitId, ...cursorNuevo })
				.onConflictDoUpdate({
					target: gpsEstanciasCursor.wialonUnitId,
					set: { ...cursorNuevo, actualizadoAt: ahora },
				});
			return true;
		});
		if (!aplicado) return { estado: "en_proceso" };

		const cantidad = await guardarUbicacionesDeUnidad({
			wialonUnitId,
			sifcos,
			ahora,
			ventanaDesde,
		});
		return {
			estado: "ok",
			ubicaciones: cantidad,
			backfill: requiereBackfill,
		};
	} finally {
		unidadesEnProceso.delete(wialonUnitId);
	}
}

// Mínimo entre dos cálculos bajo demanda de la misma unidad: el botón de la
// ficha no debe poder disparar una llamada a Wialon por clic.
const ENFRIAMIENTO_BAJO_DEMANDA_MS = 15 * 60 * 1000;

/**
 * Cálculo bajo demanda de UNA unidad (botón "Calcular ahora" de la ficha):
 * para el vehículo que todavía no tiene ubicaciones porque aún no le toca el
 * backfill del job (o es nuevo). Sin tope de backfill: es una unidad, a
 * pedido de una persona. Si se calculó hace menos de 15 minutos no vuelve a
 * Wialon, pero sí arma las ubicaciones del crédito desde las estancias guardadas.
 */
export async function calcularUbicacionesUnidadBajoDemanda(
	wialonUnitId: number,
	sifcos: string[],
): Promise<
	| { estado: "calculado"; ubicaciones: number }
	| { estado: "en_proceso" }
	| { estado: "incompleto" }
> {
	const ahora = new Date();
	const ventanaDesde = new Date(ahora.getTime() - VENTANA_DIAS * MS_POR_DIA);
	const [fila] = await db
		.select({
			procesadoHasta: gpsEstanciasCursor.procesadoHasta,
			ultimoMensajeAt: gpsEstanciasCursor.ultimoMensajeAt,
			pendienteLat: gpsEstanciasCursor.pendienteLat,
			pendienteLon: gpsEstanciasCursor.pendienteLon,
			pendienteDesde: gpsEstanciasCursor.pendienteDesde,
			pendienteHasta: gpsEstanciasCursor.pendienteHasta,
		})
		.from(gpsEstanciasCursor)
		.where(eq(gpsEstanciasCursor.wialonUnitId, wialonUnitId))
		.limit(1);

	// Calculada hace menos de 15 min: no se vuelve a Wialon, pero las
	// ubicaciones de ESTE crédito sí se arman desde las estancias ya guardadas
	// (sin red, milisegundos). Si la unidad la comparten dos créditos y el otro
	// ya la calculó, este no se queda sin ubicaciones por el enfriamiento.
	if (
		fila &&
		fila.procesadoHasta >= ventanaDesde &&
		ahora.getTime() - fila.procesadoHasta.getTime() <
			ENFRIAMIENTO_BAJO_DEMANDA_MS
	) {
		if (unidadesEnProceso.has(wialonUnitId)) return { estado: "en_proceso" };
		unidadesEnProceso.add(wialonUnitId);
		try {
			const ubicaciones = await guardarUbicacionesDeUnidad({
				wialonUnitId,
				sifcos,
				ahora: fila.procesadoHasta,
				ventanaDesde,
			});
			return { estado: "calculado", ubicaciones };
		} finally {
			unidadesEnProceso.delete(wialonUnitId);
		}
	}

	const resultado = await calcularUbicacionesUnidad({
		wialonUnitId,
		sifcos,
		cursor: fila && aCursorUnidad(fila),
		ahora,
		ventanaDesde,
	});
	return resultado.estado === "ok"
		? { estado: "calculado", ubicaciones: resultado.ubicaciones }
		: resultado;
}

type UnidadActiva = Awaited<ReturnType<typeof unidadesConCasoActivo>>[number];

/**
 * Retención de lo que guarda el cálculo de ubicaciones clave: ubicaciones,
 * estancias, cursores y la copia en el historial de consultas. Solo se conserva
 * lo de unidades con caso de cobro activo y, de lo calculado, los últimos 60
 * días: estancias (las que cruzan el borde se recortan a él), ubicaciones
 * (`calculado_at`) y snapshots del historial (`created_at` de la consulta). Son datos de dónde vive/trabaja el cliente, así que no se retienen de
 * más.
 *
 * Va aparte del cálculo y corre SIEMPRE (`correrPurgaUbicacionesClave`), no
 * detrás de GPS_UBICACIONES_ENABLED: el botón «Calcular ahora» escribe estas
 * tablas aunque el cron nocturno esté apagado, y sin purga esos datos se
 * quedarían para siempre (incluso con el caso cerrado).
 */
export async function purgarDatosUbicacionesVencidos(
	unidades: UnidadActiva[],
	ventanaDesde: Date,
): Promise<void> {
	if (unidades.length === 0) {
		// Sin unidades con caso activo hoy (casos cerrados o GPS desvinculado):
		// se purga todo lo que se retenía.
		await db.delete(gpsUbicacionesClave);
		await db.delete(gpsEstancias);
		await db.delete(gpsEstanciasCursor);
		await purgarSnapshotsUbicacionesClave();
		return;
	}

	// Purgar ubicaciones de pares (unidad, SIFCO) que ya no están activos
	// (casos cerrados o GPS desvinculado).
	const paresActivos = unidades.map((u) =>
		and(
			eq(gpsUbicacionesClave.wialonUnitId, u.wialonUnitId),
			eq(gpsUbicacionesClave.numeroCreditoSifco, u.numeroCreditoSifco),
		),
	);
	const condicionActivos =
		paresActivos.length > 1 ? or(...paresActivos)! : paresActivos[0]!;
	// También las que se calcularon hace más de la ventana: un caso activo de
	// larga vida con el cron nocturno apagado solo se recalcula si alguien usa
	// «Calcular ahora», y sin este corte esas coordenadas (hechas de los 60 días
	// anteriores a su cálculo) se quedarían guardadas y visibles indefinidamente.
	// Con el cron prendido se recalculan cada noche y nunca llegan a vencer.
	await db
		.delete(gpsUbicacionesClave)
		.where(
			or(
				not(condicionActivos),
				lt(gpsUbicacionesClave.calculadoAt, ventanaDesde),
			),
		);
	// Lo mismo con la copia que guarda el historial de consultas: se limpia el
	// snapshot de los créditos que ya no están activos y el de las consultas de
	// hace más de la ventana (la fila de auditoría —motivo, usuario, fecha— queda).
	await purgarSnapshotsUbicacionesClave(
		or(
			isNull(gpsConsultaLogs.numeroCreditoSifco),
			notInArray(gpsConsultaLogs.numeroCreditoSifco, [
				...new Set(unidades.map((u) => u.numeroCreditoSifco)),
			]),
			lt(gpsConsultaLogs.createdAt, ventanaDesde),
		),
	);

	// Las estancias se guardan por unidad física: se purgan las de unidades ya
	// sin caso activo y las que quedaron fuera de la ventana de 60 días.
	const idsUnidades = [...new Set(unidades.map((u) => u.wialonUnitId))];
	await db
		.delete(gpsEstancias)
		.where(
			or(
				notInArray(gpsEstancias.wialonUnitId, idsUnidades),
				lt(gpsEstancias.hasta, ventanaDesde),
			),
		);
	await db
		.delete(gpsEstanciasCursor)
		.where(notInArray(gpsEstanciasCursor.wialonUnitId, idsUnidades));

	// Una estancia que sigue en curso (carro parado más de 60 días en el mismo
	// lugar) extiende su `hasta` en cada corrida, así que el borrado de arriba
	// nunca la alcanza y conservaría su `desde` original: dónde estaba el
	// vehículo hace más de la ventana. Se recorta su inicio al borde. El cálculo
	// ya contaba solo desde el borde, así que el resultado no cambia.
	await db
		.update(gpsEstancias)
		.set({ desde: ventanaDesde })
		.where(
			and(
				lt(gpsEstancias.desde, ventanaDesde),
				gte(gpsEstancias.hasta, ventanaDesde),
			),
		);
}

/**
 * Purga diaria independiente de la bandera del cálculo (ver
 * `purgarDatosUbicacionesVencidos`). Nunca lanza.
 */
export async function correrPurgaUbicacionesClave(): Promise<void> {
	try {
		const ventanaDesde = new Date(Date.now() - VENTANA_DIAS * MS_POR_DIA);
		await purgarDatosUbicacionesVencidos(
			await unidadesConCasoActivo(),
			ventanaDesde,
		);
	} catch (error) {
		console.error(`${LOG_PREFIX} Error en la purga de ubicaciones:`, error);
	}
}

export async function ejecutarCalculoUbicacionesClave(): Promise<{
	unidadesProcesadas: number;
	unidadesConError: number;
	ubicacionesCalculadas: number;
	unidadesPendientesBackfill: number;
}> {
	const unidades = await unidadesConCasoActivo();
	const ahora = new Date();
	const ventanaDesde = new Date(ahora.getTime() - VENTANA_DIAS * MS_POR_DIA);

	await purgarDatosUbicacionesVencidos(unidades, ventanaDesde);
	if (unidades.length === 0) {
		return {
			unidadesProcesadas: 0,
			unidadesConError: 0,
			ubicacionesCalculadas: 0,
			unidadesPendientesBackfill: 0,
		};
	}

	// SIFCOs por unidad: una unidad compartida por dos créditos se baja una
	// sola vez y genera ubicaciones para cada SIFCO.
	const sifcosPorUnidad = new Map<number, string[]>();
	for (const { wialonUnitId, numeroCreditoSifco } of unidades) {
		const lista = sifcosPorUnidad.get(wialonUnitId) ?? [];
		lista.push(numeroCreditoSifco);
		sifcosPorUnidad.set(wialonUnitId, lista);
	}

	// Orden: lo que está en B4 primero. Es el caso de uso más urgente y el que
	// ya tenía ubicaciones antes del backfill; si falla cartera-back no se
	// prioriza nada (no es motivo para saltar la corrida).
	const sifcosB4 = new Set(await sifcosEnB4().catch(() => null));
	const idsOrdenados = [...sifcosPorUnidad.keys()].sort(
		(a, b) =>
			Number(sifcosPorUnidad.get(b)!.some((s) => sifcosB4.has(s))) -
			Number(sifcosPorUnidad.get(a)!.some((s) => sifcosB4.has(s))),
	);

	const cursores = new Map<number, CursorUnidad>(
		(await db.select().from(gpsEstanciasCursor)).map((c) => [
			c.wialonUnitId,
			aCursorUnidad(c),
		]),
	);

	let unidadesProcesadas = 0;
	let unidadesConError = 0;
	let unidadesPendientesBackfill = 0;
	let ubicacionesCalculadas = 0;
	let backfillsUsados = 0;

	// Secuencial, no en paralelo: son llamadas pesadas a Wialon para
	// potencialmente cientos de unidades — correrlas en paralelo saturaría la
	// sesión/circuit breaker del cliente compartido. El job corre una vez por
	// noche, la latencia total no es crítica.
	for (const wialonUnitId of idsOrdenados) {
		try {
			const cursor = cursores.get(wialonUnitId);
			if (!cursor || cursor.procesadoHasta < ventanaDesde) {
				if (backfillsUsados >= BACKFILL_MAX_POR_CORRIDA) {
					unidadesPendientesBackfill++;
					continue;
				}
				backfillsUsados++;
			}

			const resultado = await calcularUbicacionesUnidad({
				wialonUnitId,
				sifcos: sifcosPorUnidad.get(wialonUnitId)!,
				cursor,
				ahora,
				ventanaDesde,
			});
			if (resultado.estado !== "ok") {
				// "incompleto": se preserva el snapshot. "en_proceso": un clic de la
				// ficha la está calculando justo ahora, ya queda al día.
				if (resultado.estado === "incompleto") unidadesConError++;
				continue;
			}
			ubicacionesCalculadas += resultado.ubicaciones;

			unidadesProcesadas++;
		} catch (error) {
			unidadesConError++;
			console.error(
				`${LOG_PREFIX} Error calculando ubicaciones clave de la unidad ${wialonUnitId}:`,
				error,
			);
		}
	}

	return {
		unidadesProcesadas,
		unidadesConError,
		ubicacionesCalculadas,
		unidadesPendientesBackfill,
	};
}

// Guarda de ejecución en memoria — mismo criterio que
// gps-eventos-poll.ts::correrDeteccionEventosGps: si una corrida se demora
// más que el intervalo (acá, más de un día), el siguiente disparo no debe
// arrancar en paralelo.
let corridaEnCurso = false;

export async function correrCalculoUbicacionesClave(): Promise<void> {
	if (corridaEnCurso) {
		console.warn(
			`${LOG_PREFIX} Corrida anterior aún en curso, se salta este disparo`,
		);
		return;
	}
	corridaEnCurso = true;
	try {
		const resultado = await ejecutarCalculoUbicacionesClave();
		console.log(
			`${LOG_PREFIX} ${resultado.unidadesProcesadas} unidades procesadas · ${resultado.ubicacionesCalculadas} ubicaciones · ${resultado.unidadesConError} con error · ${resultado.unidadesPendientesBackfill} pendientes de backfill`,
		);
	} catch (error) {
		console.error(`${LOG_PREFIX} Error en la corrida:`, error);
	} finally {
		corridaEnCurso = false;
	}
}
