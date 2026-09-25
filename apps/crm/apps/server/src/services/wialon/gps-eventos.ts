/**
 * CB-119 — Registro de eventos GPS (desconexión de energía, ignición, GPS
 * sin reportar) y su notificación de cobros.
 *
 * Punto de entrada usado por el job de polling (jobs/gps-eventos-poll.ts):
 * el job detecta la transición comparando contra gps_unidad_estado, y esta
 * función se limita a resolver unidad→caso, deduplicar y notificar.
 *
 * El filtro "solo vehículos con caso de cobro activo" es implícito: el job
 * solo consulta telemetría de unidades vinculadas a casos activos (ver
 * gps-eventos-poll.ts), así que acá no hace falta filtrar de nuevo — pero
 * igual se resuelve el caso desde cero (no se confía en que el caller lo
 * mande bien) por si el vínculo cambió entre que se armó la lista y se
 * guarda el evento.
 */

import { and, desc, eq, isNotNull, notLike, sql } from "drizzle-orm";
import { db } from "../../db";
import { user } from "../../db/schema/auth";
import { casosCobros, contratosFinanciamiento } from "../../db/schema/cobros";
import { opportunities } from "../../db/schema/crm";
import { gpsEventos } from "../../db/schema/gps-eventos";
import { notifications } from "../../db/schema/notifications";
import { vehicles } from "../../db/schema/vehicles";
import { carteraBackClient } from "../cartera-back-client";
import { isCarteraBackEnabled } from "../cartera-back-integration";
import {
	filasNotificacionCobros,
	obtenerSupervisoresCobros,
	resolverUsuarioSistemaCobros,
} from "../cobros-notif-helpers";
import { sanitizarPayloadWialon } from "./wialon-clasificacion";

// Mismos valores que gps_evento_tipo (db/schema/gps-eventos.ts). No se
// importa del schema para no acoplar este módulo de dominio a
// drizzle-orm/pg-core; TypeScript igual falla si diverge, porque
// `.values({tipo: input.tipo, ...})` exige que coincidan.
export type GpsEventoTipo =
	| "desconexion_energia"
	| "ignicion"
	| "sin_reportar"
	| "salida_geocerca";

// Ventana de dedup de la NOTIFICACIÓN (no del evento crudo, que siempre se
// guarda): como mucho un aviso por vehículo+tipo dentro de la ventana.
// Energía/sin-reportar/geocerca más larga porque el job corre cada 5 min y
// el problema puede seguir presente muchas corridas seguidas; ignición más
// corta porque es un evento puntual y accionable al momento.
const VENTANA_NOTIFICACION_MS: Record<GpsEventoTipo, number> = {
	desconexion_energia: 6 * 60 * 60 * 1000,
	sin_reportar: 6 * 60 * 60 * 1000,
	salida_geocerca: 6 * 60 * 60 * 1000,
	ignicion: 24 * 60 * 60 * 1000,
};

// Desconexión de energía, GPS sin reportar y salida de geocerca escalan a
// supervisor: los tres son señales de posible manipulación del equipo o
// intento de ocultar el vehículo (justo el escenario B4/recuperación del
// ticket). Un arranque es información útil para el asesor, pero no amerita
// escalar de entrada.
const ESCALA_A_SUPERVISOR: Record<GpsEventoTipo, boolean> = {
	desconexion_energia: true,
	sin_reportar: true,
	salida_geocerca: true,
	ignicion: false,
};

const TITULO_POR_TIPO: Record<GpsEventoTipo, string> = {
	desconexion_energia: "GPS: desconexión de energía",
	ignicion: "GPS: ignición detectada",
	sin_reportar: "GPS: unidad sin reportar",
	salida_geocerca: "GPS: salida de Guatemala",
};

export interface RegistrarEventoGpsInput {
	tipo: GpsEventoTipo;
	wialonUnitId: number;
	/** Cuándo el job detectó la transición (no cuándo Wialon la generó). */
	ocurridoAt: Date;
	lat?: number;
	lon?: number;
	velocidadKmh?: number;
	/** Snapshot crudo que disparó la detección, se sanitiza y trunca antes de guardar. */
	payloadCrudo?: unknown;
	/**
	 * SIFCO B4 que originó la detección (job de polling). Cuando viene, acota
	 * la resolución de caso a ESE SIFCO puntual — si la unidad tiene más de
	 * un vehículo/caso activo (D-10, reasignación), el evento no debe caer
	 * en un caso no relacionado solo por ser el más reciente.
	 */
	numeroCreditoSifcoEsperado?: string;
}

export interface RegistrarEventoGpsResultado {
	eventoId: string;
	duplicado: boolean;
	vehicleId: string | null;
	casoCobroId: string | null;
	notificado: boolean;
}

/**
 * Resuelve la unidad de Wialon a un vehículo y, si tiene, a su caso de
 * cobro ACTIVO. Dos caminos, mismo criterio dual que `unidadesConCasoActivo`
 * en jobs/gps-eventos-poll.ts (y que `routers/wialon.ts` para la
 * vinculación masiva): por `contratoId→vehicleId` o por
 * `opportunities.vehicleId`.
 *
 * `wialonUnitId` NO es UNIQUE en `vehicles` (D-10, a propósito: la misma
 * unidad puede reasignarse tras una recuperación). Con varios vehículos
 * apuntando a la misma unidad, se prioriza el que SÍ tiene caso activo — que
 * un vehículo de prueba sin caso comparta la unidad no debe tapar al caso
 * real que sí la usa.
 *
 * `numeroCreditoSifcoEsperado` (viene del job de polling cuando la unidad se
 * originó de un SIFCO en B4): si se pasa, la búsqueda se acota a ESE SIFCO
 * en vez de "cualquier caso activo" — sin esto, una unidad con más de un
 * vehículo/caso activo (D-10) podía resolver al caso activo más reciente en
 * vez del caso B4 que disparó la corrida, notificando/guardando el evento
 * contra un caso no relacionado.
 */
async function resolverVehiculoYCaso(
	wialonUnitId: number,
	numeroCreditoSifcoEsperado?: string,
): Promise<{
	vehicleId: string | null;
	casoCobroId: string | null;
}> {
	// .orderBy + .limit(1) en ambas ramas: `wialonUnitId` no es UNIQUE en
	// `vehicles` (D-10), así que si más de un vehículo activo apunta a la
	// misma unidad, se prioriza el caso más reciente (createdAt desc) en vez
	// de dejar que el orden físico del heap scan de Postgres decida — sin
	// esto, dos corridas del mismo job podían resolver a casos distintos
	// para el mismo evento. Cuando hay SIFCO esperado, ya no hace falta
	// desempatar por fecha: el filtro deja como mucho un caso por rama.
	const filtroSifcoContrato = numeroCreditoSifcoEsperado
		? eq(casosCobros.numeroCreditoSifco, numeroCreditoSifcoEsperado)
		: and(
				isNotNull(casosCobros.numeroCreditoSifco),
				notLike(casosCobros.numeroCreditoSifco, "CRM-%"),
			);
	const filtroSifcoOportunidad = numeroCreditoSifcoEsperado
		? eq(opportunities.numeroSifco, numeroCreditoSifcoEsperado)
		: and(
				isNotNull(opportunities.numeroSifco),
				notLike(opportunities.numeroSifco, "CRM-%"),
			);

	const [porContrato, porOportunidad] = await Promise.all([
		db
			.select({ vehicleId: vehicles.id, casoCobroId: casosCobros.id })
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
					eq(vehicles.wialonUnitId, wialonUnitId),
					eq(casosCobros.activo, true),
					filtroSifcoContrato,
				),
			)
			.orderBy(desc(casosCobros.createdAt))
			.limit(1),
		db
			.select({ vehicleId: vehicles.id, casoCobroId: casosCobros.id })
			.from(vehicles)
			.innerJoin(opportunities, eq(opportunities.vehicleId, vehicles.id))
			.innerJoin(
				casosCobros,
				eq(casosCobros.numeroCreditoSifco, opportunities.numeroSifco),
			)
			.where(
				and(
					eq(vehicles.wialonUnitId, wialonUnitId),
					eq(casosCobros.activo, true),
					filtroSifcoOportunidad,
				),
			)
			.orderBy(desc(casosCobros.createdAt))
			.limit(1),
	]);

	const conCaso = porContrato[0] ?? porOportunidad[0];
	if (conCaso) return conCaso;

	// Ningún caso activo real para esta unidad: igual se guarda el evento
	// (historial), pero se resuelve el vehículo sin caso para no perder de
	// vista que la unidad SÍ está vinculada a algo.
	const [vehiculo] = await db
		.select({ id: vehicles.id })
		.from(vehicles)
		.where(eq(vehicles.wialonUnitId, wialonUnitId))
		.limit(1);

	return { vehicleId: vehiculo?.id ?? null, casoCobroId: null };
}

/**
 * Dueño REAL del crédito, sin cache — mismo patrón que
 * `aviso-bot-asesor.ts`: `casosCobros.responsableCobros` solo se llena al
 * CREAR el caso; el motor de buckets de cartera-back (`FASE 3`,
 * `controllers/latefee.ts`) sí reasigna `creditos.asesor_id` automáticamente
 * cuando el crédito cambia de bucket, y el CRM nunca sincroniza ese cambio
 * hacia `responsableCobros`. Entre el bucket de ayer y hoy el motor pudo
 * reasignar el crédito, y la alerta tiene que llegarle a quien lo lleva
 * AHORA, no a quien lo tenía cuando se creó el caso.
 *
 * `useCache=false, useCircuitBreaker=false`: best-effort (no comparte
 * contador de fallos con operaciones que sí importan) y con el dato más
 * fresco posible — no vale la pena cachear 5 min algo que decide a quién
 * alertar de un vehículo posiblemente manipulado.
 *
 * Devuelve `null` si cartera-back está deshabilitado, falla, o el crédito no
 * tiene asesor mapeable — el caller cae a `responsableCobros` como fallback
 * (mejor notificar al asesor viejo que no notificar a nadie).
 */
async function resolverAsesorActual(
	numeroCreditoSifco: string,
): Promise<string | null> {
	if (!isCarteraBackEnabled()) return null;
	try {
		const respuesta = await carteraBackClient.getCredito(
			numeroCreditoSifco,
			false,
			false,
		);
		const emailAsesor = respuesta?.asesor?.emailCashIn?.trim().toLowerCase();
		if (!emailAsesor) return null;

		// Mismo puente de identidad que el resto de cobros:
		// `asesores.email_cash_in` == `user.email`, ambos lados normalizados.
		const [usuarioAsesor] = await db
			.select({ id: user.id })
			.from(user)
			.where(sql`lower(trim(${user.email})) = ${emailAsesor}`)
			.limit(1);
		return usuarioAsesor?.id ?? null;
	} catch (error) {
		console.error(
			`[GpsEventos] No se pudo resolver el asesor actual de ${numeroCreditoSifco} (se usa responsableCobros como fallback):`,
			error,
		);
		return null;
	}
}

export async function registrarEventoGps(
	input: RegistrarEventoGpsInput,
): Promise<RegistrarEventoGpsResultado> {
	const { vehicleId, casoCobroId } = await resolverVehiculoYCaso(
		input.wialonUnitId,
		input.numeroCreditoSifcoEsperado,
	);

	// Incluye el SIFCO esperado: sin esto, una unidad reasignada de un caso
	// B4 a otro mientras la misma condición sigue activa (mismo timestamp de
	// Wialon) colisiona con el dedupKey del evento YA notificado del caso
	// viejo — el caso nuevo nunca se registraría ni notificaría, porque
	// registrarEventoGps lo trataría como duplicado del evento ajeno.
	const dedupKey = `${input.wialonUnitId}:${input.tipo}:${input.ocurridoAt.toISOString()}:${input.numeroCreditoSifcoEsperado ?? ""}`;

	const payload = input.payloadCrudo
		? sanitizarPayloadWialon(input.payloadCrudo)
		: null;

	const [insertado] = await db
		.insert(gpsEventos)
		.values({
			tipo: input.tipo,
			wialonUnitId: input.wialonUnitId,
			vehicleId,
			casoCobroId,
			ocurridoAt: input.ocurridoAt,
			lat: input.lat,
			lon: input.lon,
			velocidadKmh: input.velocidadKmh,
			payload,
			dedupKey,
		})
		.onConflictDoNothing({ target: gpsEventos.dedupKey })
		.returning({ id: gpsEventos.id });

	let eventoId: string;
	let duplicado: boolean;

	if (insertado) {
		eventoId = insertado.id;
		duplicado = false;
	} else {
		// onConflictDoNothing sin fila devuelta = ya existía (el job volvió a
		// ver la misma transición, típicamente por un reinicio a mitad de
		// corrida, o un reintento tras un fallo transitorio al notificar).
		// Si esa fila YA fue notificada, es un duplicado real y no hay nada
		// más que hacer. Si NO fue notificada (el insert del evento tuvo
		// éxito en la corrida anterior, pero la resolución de destinatarios o
		// el insert de notifications falló después), se sigue de largo y se
		// reintenta la notificación en vez de devolver "duplicado" — sin
		// esto, un fallo transitorio después de insertar el evento dejaba la
		// alerta sin notificar para siempre (mismo dedupKey en cada corrida).
		const [existente] = await db
			.select({ id: gpsEventos.id, notificado: gpsEventos.notificado })
			.from(gpsEventos)
			.where(eq(gpsEventos.dedupKey, dedupKey))
			.limit(1);
		if (!existente) {
			return {
				eventoId: "",
				duplicado: true,
				vehicleId,
				casoCobroId,
				notificado: false,
			};
		}
		if (existente.notificado) {
			return {
				eventoId: existente.id,
				duplicado: true,
				vehicleId,
				casoCobroId,
				notificado: false,
			};
		}
		eventoId = existente.id;
		duplicado = true;
	}

	if (!casoCobroId) {
		return {
			eventoId,
			duplicado,
			vehicleId,
			casoCobroId,
			notificado: false,
		};
	}

	const [caso] = await db
		.select({
			responsableCobros: casosCobros.responsableCobros,
			numeroCreditoSifco: casosCobros.numeroCreditoSifco,
		})
		.from(casosCobros)
		.where(eq(casosCobros.id, casoCobroId))
		.limit(1);

	const asesorActualId = caso?.numeroCreditoSifco
		? await resolverAsesorActual(caso.numeroCreditoSifco)
		: null;
	const asesorUserId = asesorActualId ?? caso?.responsableCobros ?? null;

	const [supervisores, usuarioSistema] = await Promise.all([
		ESCALA_A_SUPERVISOR[input.tipo]
			? obtenerSupervisoresCobros()
			: Promise.resolve<string[]>([]),
		resolverUsuarioSistemaCobros(),
	]);

	if (!usuarioSistema) {
		return {
			eventoId,
			duplicado,
			vehicleId,
			casoCobroId,
			notificado: false,
		};
	}

	const ventanaMs = VENTANA_NOTIFICACION_MS[input.tipo];
	// Ventana DESLIZANTE contra el último evento notificado de esta misma
	// unidad+tipo+caso, no un bucket fijo (ni siquiera alineado a hora de
	// Guatemala): con un bucket, dos transiciones a los dos lados de un
	// corte del bucket (ej. 23:58 y 00:08, apenas 10 min de diferencia)
	// caen en buckets distintos y ambas notifican — el bucket resuelve el
	// caso de "medianoche UTC" pero no elimina el problema en general.
	const [ultimoNotificado] = await db
		.select({ ocurridoAt: gpsEventos.ocurridoAt })
		.from(gpsEventos)
		.where(
			and(
				eq(gpsEventos.wialonUnitId, input.wialonUnitId),
				eq(gpsEventos.tipo, input.tipo),
				eq(gpsEventos.casoCobroId, casoCobroId),
				eq(gpsEventos.notificado, true),
			),
		)
		.orderBy(desc(gpsEventos.ocurridoAt))
		.limit(1);

	if (
		ultimoNotificado &&
		input.ocurridoAt.getTime() - ultimoNotificado.ocurridoAt.getTime() <
			ventanaMs
	) {
		return {
			eventoId,
			duplicado,
			vehicleId,
			casoCobroId,
			notificado: false,
		};
	}

	// dedupKey único por evento (no por bucket): la ventana deslizante de
	// arriba ya decide SI se notifica; esta llave solo evita que
	// onConflictDoNothing de notifications choque con una fila previa real.
	const dedupNotifKey = `gps:${input.tipo}:${input.wialonUnitId}:${casoCobroId}:${input.ocurridoAt.toISOString()}`;

	const filas = filasNotificacionCobros({
		casoId: casoCobroId,
		cobrosTipo: "gps_evento",
		titulo: TITULO_POR_TIPO[input.tipo],
		descripcion: descripcionEvento(input),
		asesorUserId,
		supervisores,
		usuarioSistema,
		dedupKey: dedupNotifKey,
	});

	let notificado = false;
	if (filas.length > 0) {
		const filasInsertadas = await db
			.insert(notifications)
			.values(filas)
			.onConflictDoNothing()
			.returning({ id: notifications.id });
		notificado = filasInsertadas.length > 0;
	}

	if (notificado) {
		await db
			.update(gpsEventos)
			.set({ notificado: true })
			.where(eq(gpsEventos.id, eventoId));
	}

	return {
		eventoId,
		duplicado,
		vehicleId,
		casoCobroId,
		notificado,
	};
}

function descripcionEvento(input: RegistrarEventoGpsInput): string {
	const hora = input.ocurridoAt.toLocaleString("es-GT", {
		timeZone: "America/Guatemala",
		dateStyle: "short",
		timeStyle: "short",
	});
	switch (input.tipo) {
		case "desconexion_energia":
			return `El GPS de la unidad ${input.wialonUnitId} reportó desconexión de energía (${hora}). Puede ser manipulación del equipo o corte de batería.`;
		case "ignicion":
			return `Se encendió el motor de la unidad ${input.wialonUnitId} (${hora}).`;
		case "sin_reportar":
			return `La unidad ${input.wialonUnitId} dejó de reportar señal GPS (${hora}). Verificá el estado del equipo.`;
		case "salida_geocerca":
			return `La unidad ${input.wialonUnitId} salió de Guatemala (${hora}). Verificá la ubicación del vehículo.`;
	}
}
