/**
 * CB-041 — Solicitar/aprobar/ejecutar el apagado o la reactivación de una
 * unidad, con llamada posterior al cliente registrada en la misma Ficha 360.
 *
 * Módulo aparte, no en cobros.ts: mismo motivo que convenio-decision.ts /
 * recuperacion-vehiculo.ts — cobrosAppRouter ya está en el límite donde
 * TS7056 trunca el tipo inferido en el web (ver el comentario de esos
 * archivos y https://orpc.dev/docs/advanced/exceeds-the-maximum-length-problem).
 *
 * Modo de ejecución: MANUAL. El envío automático al proveedor (LEGION,
 * `unit/exec_cmd`) no forma parte de este flujo: depende de que LEGION habilite
 * comandos/permisos/relé — ver services/inmovilizacion/ejecutor.ts.
 * `ejecutarApagado` / `ejecutarReactivacion` dejan constancia —a cargo del
 * asesor, con la confirmación de LEGION— de que se coordinó el
 * apagado/reactivación por fuera del CRM.
 */

import { ORPCError } from "@orpc/server";
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";
import { db } from "../db";
import { user } from "../db/schema/auth";
import {
	casosCobros,
	contactosCobros,
	contratosFinanciamiento,
} from "../db/schema/cobros";
import { clients } from "../db/schema/crm";
import { gpsConsultaLogs } from "../db/schema/gps-consulta-logs";
import {
	inmovilizacionesUnidad,
	inmovilizacionesUnidadEventos,
} from "../db/schema/inmovilizacion-unidad";
import { vehicles } from "../db/schema/vehicles";
import {
	usuarioDuenoEnCartera,
	usuarioDuenoEnCarteraEstricto,
} from "../lib/acceso-caso-cobro";
import { assertCreditoAsignadoEnCarteraPorSifco } from "../lib/credito-cartera-ownership";
import {
	advertenciaEnMarcha,
	BUCKETS_INMOVILIZACION,
	bucketsInmovilizacionTexto,
	CLAVES_QUE_PASO_REACTIVACION,
	componerMotivoApagado,
	componerMotivoReactivacion,
	erroresEvidenciaEjecucion,
	erroresMotivosInmovilizacion,
	erroresRespaldoReactivacion,
	erroresUbicacionSolicitud,
	estadoUnidad,
	type InmovilizacionHistorialItem,
	MIME_EVIDENCIA_INMOVILIZACION,
	type PagoRespaldo,
	type PromesaRespaldo,
	pagosPosterioresAlApagado,
	puedeSolicitar,
	type QuePasoReactivacion,
	quePasoRequierePago,
	quePasoRequierePromesa,
	type RespaldoReactivacion,
	type UbicacionInmovilizacion,
} from "../lib/inmovilizacion-unidad";
import { cobrosProcedure, cobrosSupervisorProcedure } from "../lib/orpc";
import { condicionesPromesaVigente } from "../lib/promesa-vigente";
import { PERMISSIONS } from "../lib/roles";
import {
	buildUploadPrefix,
	getFileUrl,
	MAX_FILE_SIZE,
	verifyUploadedDocumentInR2,
} from "../lib/storage";
import { carteraBackClient } from "../services/cartera-back-client";
import { isCarteraBackEnabled } from "../services/cartera-back-integration";
import { ejecutarInmovilizacion } from "../services/inmovilizacion/ejecutor";
import {
	notificarEjecucionASupervisores,
	notificarInmovilizacionPendiente,
	notificarInmovilizacionResuelta,
	notificarLlamarCliente,
	notificarUnidadReactivada,
	reconciliarAvisosLlamarCliente,
	resolverAvisoLlamarCliente,
	resolverPendientesInmovilizacion,
	resolverRecordatoriosEjecucion,
} from "../services/inmovilizacion-notif";
import { getWialonClient } from "../services/wialon/wialon-client";
import {
	conContextoGps,
	enlazarConsultaLogEnContexto,
} from "../services/wialon/wialon-contexto";
import { WialonClientError } from "../services/wialon/wialon-types";
import {
	assertAccesoCasoCobro,
	marcarInmovilizacionEnviadaARecuperacion,
} from "./cobros";
import { mensajeUsuarioWialon } from "./wialon";

export { marcarInmovilizacionEnviadaARecuperacion };

/**
 * Trae el caso con lo que hace falta para autorizar y para armar el mensaje
 * de las notificaciones ("Fulano (crédito 12345)"). No usa `getCasoCobroById`
 * (routers/cobros.ts) porque ese trae columnas de UI que acá no hacen falta.
 */
async function getCasoParaInmovilizacion(casoCobroId: string) {
	const [caso] = await db
		.select({
			id: casosCobros.id,
			numeroCreditoSifco: casosCobros.numeroCreditoSifco,
			vehicleId: vehicles.id,
			wialonUnitId: vehicles.wialonUnitId,
			wialonUnitName: vehicles.wialonUnitName,
			clienteNombre: clients.contactPerson,
		})
		.from(casosCobros)
		.leftJoin(
			contratosFinanciamiento,
			eq(casosCobros.contratoId, contratosFinanciamiento.id),
		)
		.leftJoin(clients, eq(contratosFinanciamiento.clientId, clients.id))
		.leftJoin(vehicles, eq(contratosFinanciamiento.vehicleId, vehicles.id))
		.where(eq(casosCobros.id, casoCobroId))
		.limit(1);
	return caso ?? null;
}

// ── Ubicación del vehículo (solicitud y ejecución del apagado) ──────────────

/**
 * Motivo fijo de la consulta: queda en `gps_consulta_logs` (CB-118) sin pedirle
 * nada al asesor, igual que la recuperación de vehículo (CB-042).
 */
const MOTIVO_CONSULTA_UBICACION = {
	solicitud: "Solicitud de apagado de la unidad (CB-041)",
	ejecucion: "Apagado de la unidad ejecutado (CB-041)",
} as const;
type MomentoUbicacion = keyof typeof MOTIVO_CONSULTA_UBICACION;

/** Cuánto tiempo vale una consulta para adjuntarla a una solicitud o ejecución. */
const VIGENCIA_CONSULTA_UBICACION_MS = 30 * 60 * 1000;

const origenConsultaUbicacion = (momento: MomentoUbicacion) =>
	`inmovilizacion_${momento}`;

/**
 * La ubicación que quedó guardada en el snapshot de una consulta. El snapshot
 * tiene la misma forma que el de `getGpsVehiculo` (así el historial GPS de la
 * ficha también lo muestra). Una consulta sin posición da `sin_ubicacion` con
 * el motivo, para dejar constancia en la solicitud o la ejecución.
 */
function ubicacionDesdeSnapshot(
	snapshot: unknown,
	consultaLogId: string,
	unidad: string | null,
): UbicacionInmovilizacion {
	const crudo = (snapshot ?? null) as {
		estado?: string;
		telemetria?: {
			latitude?: number;
			longitude?: number;
			speedKmh?: number;
			isIgnitionOn?: boolean;
			ultimaPosicionAt?: string | null;
			ultimaSenalAt?: string | null;
		};
		error?: { message?: string };
	} | null;
	const t = crudo?.estado === "vinculado" ? crudo.telemetria : undefined;
	if (t && t.latitude != null && t.longitude != null) {
		const u: UbicacionInmovilizacion = {
			fuente: "gps",
			lat: t.latitude,
			lng: t.longitude,
			unidad,
			senalAt: t.ultimaPosicionAt ?? t.ultimaSenalAt ?? null,
			velocidadKmh: t.speedKmh ?? null,
			ignicion: t.isIgnitionOn ?? null,
			consultaLogId,
		};
		return { ...u, aviso: advertenciaEnMarcha(u) };
	}
	return {
		fuente: "sin_ubicacion",
		unidad,
		consultaLogId,
		aviso:
			crudo?.error?.message ??
			(crudo?.estado === "vinculado"
				? "La unidad respondió sin posición."
				: "No se pudo consultar el GPS."),
	};
}

/**
 * Lee una consulta de ubicación ya hecha, para adjuntarla a la solicitud o a la
 * ejecución. Tiene que ser del mismo usuario y vehículo, del mismo momento y
 * reciente: así el cliente no puede mandar coordenadas inventadas, solo apuntar
 * a una consulta auditada.
 */
async function leerUbicacionConsulta(params: {
	consultaLogId: string;
	userId: string;
	vehicleId: string;
	momento: MomentoUbicacion;
}): Promise<UbicacionInmovilizacion | null> {
	const [log] = await db
		.select({
			snapshot: gpsConsultaLogs.snapshot,
			unitName: gpsConsultaLogs.unitName,
		})
		.from(gpsConsultaLogs)
		.where(
			and(
				eq(gpsConsultaLogs.id, params.consultaLogId),
				eq(gpsConsultaLogs.userId, params.userId),
				eq(gpsConsultaLogs.vehicleId, params.vehicleId),
				eq(gpsConsultaLogs.origen, origenConsultaUbicacion(params.momento)),
				gt(
					gpsConsultaLogs.createdAt,
					new Date(Date.now() - VIGENCIA_CONSULTA_UBICACION_MS),
				),
			),
		)
		.limit(1);
	if (!log) return null;
	return ubicacionDesdeSnapshot(
		log.snapshot,
		params.consultaLogId,
		log.unitName,
	);
}

/**
 * Historial completo de inmovilizaciones de un caso, para derivar el estado
 * de la unidad y mostrarlo en la Ficha 360.
 */
async function getHistorialCaso(casoCobroId: string) {
	return db
		.select()
		.from(inmovilizacionesUnidad)
		.where(eq(inmovilizacionesUnidad.casoCobroId, casoCobroId))
		.orderBy(desc(inmovilizacionesUnidad.createdAt));
}

type FilaInmovilizacion = Awaited<ReturnType<typeof getHistorialCaso>>[number];

/**
 * La llamada al cliente enlazada a una inmovilización (la gestión que se
 * registró tras el apagado o la reactivación), para verla desde el historial.
 */
type LlamadaInmovilizacion = {
	id: string;
	fechaContacto: Date;
	estadoContacto: string;
	duracionLlamada: number | null;
	comentarios: string;
	acuerdosAlcanzados: string | null;
	realizadoPorNombre: string | null;
};

/**
 * La fila de la carta: lo mismo más lo que hace falta para mostrar la
 * ejecución del asesor —quién la registró y la confirmación de LEGION— y la
 * llamada enlazada. La llave de R2 se reemplaza por una URL firmada (el bucket
 * es privado); una que no se pueda firmar queda en null, sin tumbar la carta.
 */
type FilaInmovilizacionCarta = Omit<FilaInmovilizacion, "evidenciaR2Key"> & {
	evidenciaUrl: string | null;
	ejecutadoPorNombre: string | null;
	llamada: LlamadaInmovilizacion | null;
};

async function enriquecerFilasCarta(
	filas: readonly FilaInmovilizacion[],
): Promise<FilaInmovilizacionCarta[]> {
	// Las gestiones enlazadas (la llamada de cada inmovilización). Se leen antes
	// que los nombres para pedir en una sola consulta a los usuarios de ambos.
	const contactoIds = [
		...new Set(
			filas.map((f) => f.llamadaContactoId).filter((id): id is string => !!id),
		),
	];
	const contactos = new Map<
		string,
		Omit<LlamadaInmovilizacion, "realizadoPorNombre"> & {
			realizadoPor: string;
		}
	>();
	if (contactoIds.length > 0) {
		for (const c of await db
			.select({
				id: contactosCobros.id,
				fechaContacto: contactosCobros.fechaContacto,
				estadoContacto: contactosCobros.estadoContacto,
				duracionLlamada: contactosCobros.duracionLlamada,
				comentarios: contactosCobros.comentarios,
				acuerdosAlcanzados: contactosCobros.acuerdosAlcanzados,
				realizadoPor: contactosCobros.realizadoPor,
			})
			.from(contactosCobros)
			.where(inArray(contactosCobros.id, contactoIds))) {
			contactos.set(c.id, c);
		}
	}

	const ids = [
		...new Set([
			...filas.map((f) => f.ejecutadoPor).filter((id): id is string => !!id),
			...[...contactos.values()].map((c) => c.realizadoPor),
		]),
	];
	const nombres = new Map<string, string>();
	if (ids.length > 0) {
		for (const u of await db
			.select({ id: user.id, name: user.name })
			.from(user)
			.where(inArray(user.id, ids))) {
			nombres.set(u.id, u.name);
		}
	}
	return Promise.all(
		filas.map(async ({ evidenciaR2Key, ...fila }) => {
			const contacto = fila.llamadaContactoId
				? contactos.get(fila.llamadaContactoId)
				: undefined;
			return {
				...fila,
				evidenciaUrl: evidenciaR2Key
					? await getFileUrl(evidenciaR2Key).catch(() => null)
					: null,
				ejecutadoPorNombre: fila.ejecutadoPor
					? (nombres.get(fila.ejecutadoPor) ?? null)
					: null,
				llamada: contacto
					? {
							id: contacto.id,
							fechaContacto: contacto.fechaContacto,
							estadoContacto: contacto.estadoContacto,
							duracionLlamada: contacto.duracionLlamada,
							comentarios: contacto.comentarios,
							acuerdosAlcanzados: contacto.acuerdosAlcanzados,
							realizadoPorNombre: nombres.get(contacto.realizadoPor) ?? null,
						}
					: null,
			};
		}),
	);
}

/**
 * Historial de inmovilizaciones de la UNIDAD FÍSICA, cruzando todos los
 * `caso_cobro_id` que comparten el mismo `wialon_unit_id` — no solo el caso
 * que está pidiendo. `wialonUnitId` no es UNIQUE en `vehicles` (D-10, ver
 * jobs/gps-eventos-poll.ts): dos casos legítimos (reasignación en curso, o
 * dos créditos compartiendo GPS) pueden apuntar a la misma unidad. Si el
 * estado se derivara solo del historial de un caso, el Caso B nunca vería el
 * apagado que el Caso A ya ejecutó sobre la MISMA unidad física: creería que
 * está "activa" cuando en realidad está apagada, podría pedir otro apagado
 * duplicado, y no podría pedir la reactivación real que sí hace falta.
 * Review de Codex, PR #1758.
 *
 * Sin `wialonUnitId` (caso sin vehículo vinculado) no hay unidad física que
 * cruzar: se usa el historial normal, por caso.
 */
async function getHistorialUnidadFisica(
	casoCobroId: string,
	wialonUnitId: number | null,
): Promise<FilaInmovilizacion[]> {
	if (wialonUnitId == null) return getHistorialCaso(casoCobroId);
	return db
		.select()
		.from(inmovilizacionesUnidad)
		.where(eq(inmovilizacionesUnidad.wialonUnitId, wialonUnitId))
		.orderBy(desc(inmovilizacionesUnidad.createdAt));
}

/**
 * Ejecutor de transacción de Drizzle — el tipo real de `tx` en
 * `db.transaction(async (tx) => ...)`, inferido sin necesitar el import de
 * Postgres/Drizzle solo para esta anotación.
 */
type TxExecutor = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Serializa, dentro de una transacción, TODA la actividad de una unidad
 * física (o, sin `wialonUnitId`, del caso) — mismo patrón que
 * `bloquearUnidadWialon` en `routers/wialon.ts`.
 *
 * Necesario porque `ejecutarAprobada` y `registrarLlamadaApagado` /
 * `registrarLlamadaReactivacion` toman locks de FILA en orden potencialmente
 * inverso: `ejecutarAprobada` de una reactivación lockea primero la
 * reactivación (su propio UPDATE) y DESPUÉS el apagado origen
 * (inmovilizacionOrigenId); `registrarLlamadaApagado` sobre ese mismo
 * apagado lockea primero el apagado (SELECT ... FOR UPDATE) y su INSERT de
 * la reactivación de seguimiento puede esperar por el índice único parcial,
 * que depende de esa otra fila. Dos transacciones esperándose la una a la
 * otra en orden cruzado es un deadlock (40P01) — Postgres lo detecta y
 * aborta una de las dos, pero ese error no es un CONFLICT de negocio, sale
 * como 500 crudo si nadie lo traduce.
 *
 * El advisory lock por unidad reemplaza esa carrera de locks de fila por
 * una cola simple: la segunda transacción que toque la misma unidad espera
 * a que la primera termine por completo (commit o rollback), sin poder
 * quedar esperándose mutuamente. Review de Codex, PR #1758.
 */
async function bloquearUnidadFisica(
	tx: TxExecutor,
	params: { casoCobroId: string; wialonUnitId: number | null },
): Promise<void> {
	const clave =
		params.wialonUnitId != null
			? `wialon_unit:${params.wialonUnitId}`
			: `inmovilizacion_caso:${params.casoCobroId}`;
	await tx.execute(
		sql`select pg_advisory_xact_lock(hashtextextended(${clave}, 0))`,
	);
}

/**
 * `getHistorialUnidadFisica`, pero corriendo dentro de una transacción con
 * el `tx` ya lockeado (SELECT ... FOR UPDATE) sobre la fila que importa.
 * Se usa como curry: `getHistorialUnidadFisicaTx(tx)` da una función con la
 * misma firma que `getHistorialUnidadFisica`, para poder reusar
 * `filaSigueVigente` en ambos contextos — fuera de transacción (chequeo
 * temprano, sin lock) y dentro (chequeo real, con lock).
 */
function getHistorialUnidadFisicaTx(
	tx: TxExecutor,
): typeof getHistorialUnidadFisica {
	return async (casoCobroId, wialonUnitId) => {
		if (wialonUnitId == null) {
			return tx
				.select()
				.from(inmovilizacionesUnidad)
				.where(eq(inmovilizacionesUnidad.casoCobroId, casoCobroId))
				.orderBy(desc(inmovilizacionesUnidad.createdAt));
		}
		return tx
			.select()
			.from(inmovilizacionesUnidad)
			.where(eq(inmovilizacionesUnidad.wialonUnitId, wialonUnitId))
			.orderBy(desc(inmovilizacionesUnidad.createdAt));
	};
}

/**
 * ¿`fila` sigue siendo la acción EJECUTADA vigente de la unidad física? Dos
 * condiciones, no solo una:
 *  1. `estadoUnidad` (mira la acción ejecutada más reciente de CUALQUIER
 *     tipo, no solo las de `fila.accion`) da el estado esperado para esa
 *     acción — "inmovilizada" si `fila.accion === "apagado"`, "activa" si
 *     es "reactivacion". Comparar solo entre filas de la misma acción no
 *     detecta que una acción MÁS RECIENTE de otro tipo ya superó a `fila`.
 *  2. Esa fila vigente es justo `fila.id` (no otra fila vieja de otro caso,
 *     D-10 — unidad compartida).
 * Se usa en `registrarLlamadaApagado` y `registrarLlamadaReactivacion`,
 * primero sin lock (mensaje de error temprano) y de nuevo con
 * `SELECT ... FOR UPDATE` dentro de la transacción (la garantía real bajo
 * concurrencia). Review de Codex, PR #1758.
 */
async function filaSigueVigente(
	fila: Pick<
		FilaInmovilizacion,
		"id" | "casoCobroId" | "wialonUnitId" | "accion"
	>,
	historialFn: typeof getHistorialUnidadFisica,
): Promise<boolean> {
	const historial = await historialFn(fila.casoCobroId, fila.wialonUnitId);
	const historialParaEstado: InmovilizacionHistorialItem[] = historial.map(
		(h) => ({
			accion: h.accion,
			estado: h.estado,
			ejecutadoAt: h.ejecutadoAt,
		}),
	);
	const estadoEsperado = fila.accion === "apagado" ? "inmovilizada" : "activa";
	const filaVigente = ultimaEjecutada(historial, fila.accion);
	return (
		estadoUnidad(historialParaEstado) === estadoEsperado &&
		filaVigente?.id === fila.id
	);
}

/**
 * Determina si una inmovilización ejecutada aún requiere que se envíe o
 * mantenga abierto el aviso de "llamar al cliente" (o confirmación de
 * reactivación).
 *
 * Retorna false si:
 * 1. La llamada de confirmación ya fue registrada (`llamadaContactoId !== null`).
 * 2. La acción quedó obsoleta por un evento posterior en la unidad física
 *    (apagado superado por reactivación, o reactivación superada por nuevo apagado).
 */
async function necesitaAvisoLlamada(
	inm: Pick<
		FilaInmovilizacion,
		"id" | "casoCobroId" | "wialonUnitId" | "accion"
	>,
): Promise<boolean> {
	const [actual] = await db
		.select()
		.from(inmovilizacionesUnidad)
		.where(eq(inmovilizacionesUnidad.id, inm.id))
		.limit(1);

	if (
		!actual ||
		(actual.llamadaContactoId ?? null) !== null ||
		actual.estado !== "ejecutada"
	) {
		return false;
	}

	return filaSigueVigente(actual, getHistorialUnidadFisica);
}

/**
 * La fila EJECUTADA más reciente (por `ejecutadoAt`) de una `accion` dada.
 * Con "apagado" es la que tiene la unidad apagada hoy cuando `estadoUnidad`
 * dice "inmovilizada" — la usan el banner de "llamar al cliente" y la
 * reactivación directa (para enlazar su `inmovilizacionOrigenId`). Con
 * "reactivacion" es la que acaba de devolver la unidad al cliente — la usa
 * el banner de "confirmar llamada" post-reactivación.
 */
function ultimaEjecutada(
	historial: readonly FilaInmovilizacion[],
	accion: FilaInmovilizacion["accion"],
): FilaInmovilizacion | null {
	let ultimo: FilaInmovilizacion | null = null;
	for (const h of historial) {
		if (h.accion !== accion || h.estado !== "ejecutada" || !h.ejecutadoAt)
			continue;
		if (!ultimo?.ejecutadoAt || h.ejecutadoAt > ultimo.ejecutadoAt) ultimo = h;
	}
	return ultimo;
}

/**
 * ¿El error es una violación de índice único de Postgres (23505)? Drizzle
 * puede envolver el error del driver, así que se mira también `cause`. Solo
 * esto se traduce a CONFLICT: una caída de la DB o una FK rota tienen que
 * salir como lo que son, no como "ya hay una solicitud abierta".
 */
function esViolacionUnica(error: unknown): boolean {
	const codigo = (e: unknown) => (e as { code?: unknown } | null)?.code;
	return (
		codigo(error) === "23505" ||
		codigo((error as { cause?: unknown } | null)?.cause) === "23505"
	);
}

/**
 * Verifica que el usuario tenga acceso para registrar la llamada de una
 * inmovilización ejecutada (`registrarLlamadaApagado` o
 * `registrarLlamadaReactivacion`).
 *
 * El caso normal es el gate de toda la ficha: el asesor que lleva el crédito
 * en CARTERA (o lo cubre hoy), o un rol con visibilidad completa. Pero si el
 * dueño en cartera no tiene usuario en el CRM, `ejecutarAprobada` enrutó el
 * aviso de llamada a `inm.solicitadoPor`: autorizar a ese usuario evita que la
 * tarea quede trabada sin nadie que pueda cerrarla. Review de Codex.
 */
async function assertAccesoLlamadaInmovilizacion(
	inm: { casoCobroId: string; solicitadoPor: string | null },
	userId: string,
	userRole: string,
): Promise<void> {
	try {
		await assertAccesoCasoCobro(inm.casoCobroId, userId, userRole);
		return;
	} catch (error) {
		if (!(error instanceof ORPCError) || error.code !== "NOT_FOUND")
			throw error;
	}

	// Fallback: el aviso cayó en quien solicitó porque el dueño en cartera no
	// tiene usuario en el CRM. Con la lectura ESTRICTA: si cartera no responde
	// se lanza (falla cerrado), no se toma como "sin usuario" (review de
	// Codex, P1, PR #1765).
	if (inm.solicitadoPor && inm.solicitadoPor === userId) {
		const [caso] = await db
			.select({ numeroCreditoSifco: casosCobros.numeroCreditoSifco })
			.from(casosCobros)
			.where(eq(casosCobros.id, inm.casoCobroId))
			.limit(1);
		if (
			caso &&
			(await usuarioDuenoEnCarteraEstricto(caso.numeroCreditoSifco)) === null
		) {
			return;
		}
	}

	throw new ORPCError("NOT_FOUND", {
		message: "Caso de cobro no encontrado o sin acceso.",
	});
}

// ── Respaldo de la reactivación: pagos posteriores al apagado y promesa ─────

/**
 * Pagos de cartera-back que pueden respaldar la reactivación: los del día del
 * apagado en adelante. Sin caché (un pago recién registrado tiene que verse de
 * inmediato). Si cartera no responde, lanza: no se puede verificar el pago.
 */
async function leerPagosPosterioresAlApagado(
	numeroCreditoSifco: string,
	apagadoEjecutadoAt: Date,
): Promise<PagoRespaldo[]> {
	if (!isCarteraBackEnabled()) {
		throw new ORPCError("SERVICE_UNAVAILABLE", {
			message:
				"La integración con cartera no está habilitada: no se pueden verificar pagos.",
		});
	}
	let pagos: Awaited<ReturnType<typeof carteraBackClient.getPagosByCredito>>;
	try {
		pagos = await carteraBackClient.getPagosByCredito(
			numeroCreditoSifco,
			false,
		);
	} catch (error) {
		console.error("[inmovilizacion] No se pudieron leer los pagos:", error);
		throw new ORPCError("SERVICE_UNAVAILABLE", {
			message:
				"No se pudieron consultar los pagos en cartera. Intentá de nuevo en un momento.",
		});
	}
	return pagosPosterioresAlApagado(pagos, apagadoEjecutadoAt);
}

/** La promesa de pago activa del caso (la misma definición que usa la ficha), o null. */
async function leerPromesaActivaCaso(
	casoCobroId: string,
): Promise<PromesaRespaldo | null> {
	const [promesa] = await db
		.select({
			id: contactosCobros.id,
			fechaProximoContacto: contactosCobros.fechaProximoContacto,
			montoComprometido: contactosCobros.montoComprometido,
		})
		.from(contactosCobros)
		.where(
			and(
				eq(contactosCobros.casoCobroId, casoCobroId),
				...condicionesPromesaVigente(),
			),
		)
		.limit(1);
	if (!promesa?.fechaProximoContacto) return null;
	return {
		contactoId: promesa.id,
		fechaPrometida: new Date(promesa.fechaProximoContacto).toISOString(),
		monto: promesa.montoComprometido ?? null,
	};
}

/**
 * Arma el respaldo de una reactivación desde los datos REALES (no los que
 * mande el navegador): el pago elegido tiene que estar en cartera y ser
 * posterior al apagado; la promesa, la activa del caso. Lanza BAD_REQUEST con
 * lo que falte según la opción elegida.
 */
async function resolverRespaldoReactivacion(params: {
	quePaso: QuePasoReactivacion;
	pagoId: number | undefined;
	casoCobroId: string;
	numeroCreditoSifco: string;
	apagadoEjecutadoAt: Date;
}): Promise<RespaldoReactivacion> {
	const respaldo: RespaldoReactivacion = {};
	if (quePasoRequierePago(params.quePaso)) {
		const pagos = await leerPagosPosterioresAlApagado(
			params.numeroCreditoSifco,
			params.apagadoEjecutadoAt,
		);
		const elegido = pagos.find((p) => p.pagoId === params.pagoId);
		if (elegido) respaldo.pago = elegido;
	}
	if (quePasoRequierePromesa(params.quePaso)) {
		const promesa = await leerPromesaActivaCaso(params.casoCobroId);
		if (promesa) respaldo.promesa = promesa;
	}
	const error = erroresRespaldoReactivacion(params.quePaso, respaldo);
	if (error) throw new ORPCError("BAD_REQUEST", { message: error });
	return respaldo;
}

/**
 * Datos que aporta el asesor al ejecutar un apagado (vs. la ejecución manual del
 * supervisor, que solo trae una referencia de texto): la confirmación de LEGION
 * como archivo y/o nota, y dónde estaba el vehículo en ese momento.
 */
type ExtrasEjecucion = {
	evidencia: { key: string; nombreArchivo: string; mime: string } | null;
	nota: string | null;
	/** Solo el apagado consulta dónde está el vehículo. */
	ubicacion: UbicacionInmovilizacion | null;
};

/**
 * Pasa una solicitud `aprobada` a `ejecutada` — cuerpo compartido por
 * `ejecutarApagado` y `ejecutarReactivacion` (las dos las registra el asesor).
 * Revalida bucket y vínculo GPS, deja el evento de auditoría con quién lo hizo
 * y avisa al asesor que llame al cliente.
 */
async function ejecutarAprobada(
	input: { id: string; referencia?: string; extras?: ExtrasEjecucion },
	context: {
		userId: string;
		userRole: NonNullable<
			Parameters<typeof notificarLlamarCliente>[0]["ejecutadoPorRole"]
		>;
	},
) {
	const [inm] = await db
		.select()
		.from(inmovilizacionesUnidad)
		.where(
			and(
				eq(inmovilizacionesUnidad.id, input.id),
				eq(inmovilizacionesUnidad.estado, "aprobada"),
			),
		)
		.limit(1);

	if (!inm) {
		throw new ORPCError("CONFLICT", {
			message: "La solicitud no está aprobada (o ya fue ejecutada).",
		});
	}

	let motivoFalloPrecondicion: string | null = null;

	// Apagado: el asesor lo registra DESPUÉS de que LEGION ya lo aplicó. Si el
	// crédito bajó de bucket entre la aprobación y ahora (lo normal: el cliente
	// notó el apagado y pagó), cancelar la solicitud dejaría el carro apagado en
	// la realidad y "activo" en el CRM, sin forma de pedir la reactivación. Por
	// eso el bucket ya no cancela: la revisión estricta vive en la aprobación
	// (`decidirInmovilizacion`) y acá solo queda la advertencia, en la respuesta,
	// en el evento de auditoría y en el aviso a los supervisores.
	let advertencia: string | null = null;
	let bucketAlEjecutar: number | null = null;
	if (inm.accion === "apagado" && isCarteraBackEnabled()) {
		try {
			const bucketActual = await carteraBackClient.getBucketActualCredito(
				inm.numeroCreditoSifco,
			);
			bucketAlEjecutar = bucketActual?.bucket ?? null;
		} catch (error) {
			console.error("[ejecutarAprobada] No se pudo resolver el bucket:", error);
		}
		if (bucketAlEjecutar == null) {
			advertencia =
				"No se pudo confirmar el bucket del crédito en cartera: verificá que el apagado siga aplicando.";
		} else if (!BUCKETS_INMOVILIZACION.includes(bucketAlEjecutar)) {
			advertencia = `El crédito ya no está en ${bucketsInmovilizacionTexto()} (está en B${bucketAlEjecutar}), seguramente porque el cliente pagó. El apagado quedó registrado porque LEGION ya lo aplicó: solicitá la reactivación.`;
		}
	}

	let resultado!: Awaited<ReturnType<typeof ejecutarInmovilizacion>>;

	await db.transaction(async (tx) => {
		// Serializa contra registrarLlamadaApagado / registrarLlamadaReactivacion
		// sobre la MISMA unidad física — evita el deadlock de locks de fila
		// en orden cruzado (esta transacción toca `input.id` y después
		// `inmovilizacionOrigenId`; la otra puede tocarlos al revés). Ver
		// comentario de `bloquearUnidadFisica`. Review de Codex, PR #1758.
		await bloquearUnidadFisica(tx, {
			casoCobroId: inm.casoCobroId,
			wialonUnitId: inm.wialonUnitId,
		});

		// Re-validar la vinculación Wialon del vehículo bajo lock (FOR UPDATE):
		// el lock de fila sobre vehicles serializa contra vincularUnidadWialon
		// (que toma lock exclusivo al reasignar la unidad del vehículo),
		// evitando que el GPS sea reemplazado concurrentemente entre esta
		// lectura y ejecutarInmovilizacion. Review de Codex.
		if (!motivoFalloPrecondicion) {
			if (!inm.vehicleId) {
				motivoFalloPrecondicion =
					"El vehículo asociado a la solicitud ya no existe o fue desasociado.";
			} else {
				const [vehiculoTx] = await tx
					.select({ wialonUnitId: vehicles.wialonUnitId })
					.from(vehicles)
					.where(eq(vehicles.id, inm.vehicleId))
					.for("update")
					.limit(1);

				if (!vehiculoTx) {
					motivoFalloPrecondicion =
						"El vehículo asociado a la solicitud ya no existe o fue desasociado.";
				} else if (
					inm.wialonUnitId == null ||
					vehiculoTx.wialonUnitId == null
				) {
					motivoFalloPrecondicion =
						"El vehículo asociado no tiene una unidad GPS vinculada.";
				} else if (vehiculoTx.wialonUnitId !== inm.wialonUnitId) {
					motivoFalloPrecondicion =
						"La unidad GPS del vehículo cambió o fue reasignada tras la aprobación. La acción ya no aplica a la unidad original.";
				}
			}
		}

		if (motivoFalloPrecondicion) {
			// Precondición de ejecución falló (el cliente pagó, el vehículo fue
			// desasociado o el GPS fue reasignado tras la aprobación). En vez de
			// dejar la fila huérfana en 'aprobada' (que bloquearía permanentemente
			// cualquier solicitud futura del caso por el índice único de abiertas),
			// se cancela atómicamente la aprobación y se audita el evento. Review de Codex.
			const [cancelada] = await tx
				.update(inmovilizacionesUnidad)
				.set({
					estado: "cancelada",
					updatedAt: new Date(),
				})
				.where(
					and(
						eq(inmovilizacionesUnidad.id, input.id),
						eq(inmovilizacionesUnidad.estado, "aprobada"),
					),
				)
				.returning({ id: inmovilizacionesUnidad.id });

			// Solo auditar si esta transacción fue la que canceló la fila: si dos
			// supervisores ejecutaron concurrentemente con precondición fallida,
			// el segundo UPDATE devuelve cero filas y no debe duplicar el evento.
			// Review de Codex, PR #1758.
			if (cancelada) {
				await tx.insert(inmovilizacionesUnidadEventos).values({
					inmovilizacionId: input.id,
					evento: "cancelar",
					estadoAnterior: "aprobada",
					estadoNuevo: "cancelada",
					usuarioId: context.userId,
					detalle: { motivo: motivoFalloPrecondicion },
				});
			}
			return;
		}

		resultado = await ejecutarInmovilizacion({
			accion: inm.accion,
			wialonUnitId: inm.wialonUnitId,
		});

		const [actualizada] = await tx
			.update(inmovilizacionesUnidad)
			.set({
				estado: "ejecutada",
				ejecutadoPor: context.userId,
				ejecutadoAt: new Date(),
				modoEjecucion: resultado.modo,
				// Ejecución del asesor: la nota hace de referencia, para que la cola
				// y el historial (que leen `referenciaEjecucion`) la sigan mostrando.
				referenciaEjecucion: input.extras?.nota ?? input.referencia ?? null,
				...(input.extras
					? {
							evidenciaR2Key: input.extras.evidencia?.key ?? null,
							evidenciaNombreArchivo:
								input.extras.evidencia?.nombreArchivo ?? null,
							evidenciaMime: input.extras.evidencia?.mime ?? null,
							evidenciaNota: input.extras.nota,
							ubicacionEjecucion: input.extras.ubicacion,
						}
					: {}),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(inmovilizacionesUnidad.id, input.id),
					eq(inmovilizacionesUnidad.estado, "aprobada"),
				),
			)
			.returning({ id: inmovilizacionesUnidad.id });

		if (!actualizada) {
			throw new ORPCError("CONFLICT", {
				message: "La solicitud ya no está aprobada.",
			});
		}

		await tx.insert(inmovilizacionesUnidadEventos).values({
			inmovilizacionId: input.id,
			evento: "marcar_ejecutada",
			estadoAnterior: "aprobada",
			estadoNuevo: "ejecutada",
			usuarioId: context.userId,
			detalle: {
				modo: resultado.modo,
				referencia: input.referencia,
				// Bucket del crédito al registrar (y si salió con advertencia): el
				// apagado ya estaba aplicado, esto solo deja constancia.
				bucketAlEjecutar,
				advertencia,
				// Auditoría de la ejecución del asesor: qué adjuntó y dónde estaba
				// el vehículo. Quién lo hizo y cuándo: `usuarioId` y `createdAt`.
				...(input.extras
					? {
							nota: input.extras.nota,
							evidencia: input.extras.evidencia,
							ubicacion: input.extras.ubicacion,
						}
					: {}),
			},
		});

		// La reactivación cierra el ciclo del apagado que la originó.
		if (inm.accion === "reactivacion" && inm.inmovilizacionOrigenId) {
			await tx
				.update(inmovilizacionesUnidad)
				.set({ resultado: "reactivada", updatedAt: new Date() })
				.where(eq(inmovilizacionesUnidad.id, inm.inmovilizacionOrigenId));
		}
	});

	if (motivoFalloPrecondicion) {
		await resolverPendientesInmovilizacion(input.id);
		await resolverRecordatoriosEjecucion(input.id);
		throw new ORPCError("CONFLICT", {
			message: motivoFalloPrecondicion,
		});
	}

	// Ya se ejecutó: el recordatorio de "falta ejecutarlo" deja de aplicar.
	await resolverRecordatoriosEjecucion(input.id);

	// Reactivación directa (cliente pagó por ventanilla, sin pasar por
	// registrarLlamadaApagado): el aviso "llamar al cliente" del
	// apagado que originó esto queda con nada que resolverlo — el
	// banner ya desapareció de la Ficha 360 (pendienteLlamar se apaga
	// solo cuando la unidad vuelve a "activa"), pero el aviso en
	// notifications seguía pending para siempre. Review de Codex.
	if (inm.accion === "reactivacion" && inm.inmovilizacionOrigenId) {
		await resolverAvisoLlamarCliente(inm.inmovilizacionOrigenId);
	}

	// Apagado posterior: deja la unidad inmovilizada y deja obsoleta
	// cualquier llamada de confirmación pendiente de una reactivación
	// anterior sobre la misma unidad física (o caso): la Ficha 360 ya
	// no muestra el banner (pendienteLlamarReactivacion requiere unidad
	// activa) y registrarLlamadaReactivacion la rechaza. Sin esto, el
	// aviso "unidad reactivada" quedaba pending para siempre en
	// notifications (la resolución manual está bloqueada para este
	// tipo).
	if (inm.accion === "apagado") {
		const reactivacionesObsoletas = await (inm.wialonUnitId != null
			? db
					.select({ id: inmovilizacionesUnidad.id })
					.from(inmovilizacionesUnidad)
					.where(
						and(
							eq(inmovilizacionesUnidad.wialonUnitId, inm.wialonUnitId),
							eq(inmovilizacionesUnidad.accion, "reactivacion"),
							eq(inmovilizacionesUnidad.estado, "ejecutada"),
							isNull(inmovilizacionesUnidad.llamadaContactoId),
						),
					)
			: db
					.select({ id: inmovilizacionesUnidad.id })
					.from(inmovilizacionesUnidad)
					.where(
						and(
							eq(inmovilizacionesUnidad.casoCobroId, inm.casoCobroId),
							eq(inmovilizacionesUnidad.accion, "reactivacion"),
							eq(inmovilizacionesUnidad.estado, "ejecutada"),
							isNull(inmovilizacionesUnidad.llamadaContactoId),
						),
					));

		for (const r of reactivacionesObsoletas) {
			await resolverAvisoLlamarCliente(r.id);
		}
	}

	const caso = await getCasoParaInmovilizacion(inm.casoCobroId);

	// Los supervisores se enteran de que el apagado o la reactivación ya se aplicó.
	await notificarEjecucionASupervisores({
		inmovilizacionId: inm.id,
		casoCobroId: inm.casoCobroId,
		accion: inm.accion,
		advertencia: advertencia ?? undefined,
		clienteNombre: caso?.clienteNombre ?? undefined,
		numeroCreditoSifco: inm.numeroCreditoSifco,
		ejecutadoPorUserId: context.userId,
		ejecutadoPorRole: context.userRole,
	});

	// Al asesor que lleva el crédito en CARTERA. Fallback a quien
	// solicitó: sin esto, un dueño sin usuario en el CRM dejaba el aviso
	// sin nadie — ni el asesor, ni quien pidió la acción. Review de Codex.
	const asesorUserId =
		(await usuarioDuenoEnCartera(caso?.numeroCreditoSifco)) ??
		inm.solicitadoPor;
	if (asesorUserId) {
		if (await necesitaAvisoLlamada(inm)) {
			if (inm.accion === "apagado") {
				await notificarLlamarCliente({
					inmovilizacionId: inm.id,
					casoCobroId: inm.casoCobroId,
					asesorUserId,
					clienteNombre: caso?.clienteNombre ?? undefined,
					ejecutadoPorUserId: context.userId,
					ejecutadoPorRole: context.userRole,
				});
			} else {
				// El asesor es quien le avisa al cliente que ya puede usar el
				// vehículo: sin este aviso no se entera de que LEGION lo reactivó.
				await notificarUnidadReactivada({
					inmovilizacionId: inm.id,
					casoCobroId: inm.casoCobroId,
					asesorUserId,
					clienteNombre: caso?.clienteNombre ?? undefined,
					ejecutadoPorUserId: context.userId,
					ejecutadoPorRole: context.userRole,
				});
			}

			// Reconciliación:
			// 1. Si entre la comprobación previa y el await de envío se completó una
			// llamada o la acción quedó superada por un evento posterior en la unidad
			// física, la resolución de avisos corrió antes de que esta fila existiera
			// en notifications. Re-verificamos y cerramos el aviso si ya no aplica.
			if (!(await necesitaAvisoLlamada(inm))) {
				await resolverAvisoLlamarCliente(inm.id);
			} else {
				// 2. Si cartera reasignó el crédito entre la lectura temprana y el
				// envío del aviso, el aviso recién creado quedó asignado al asesor
				// anterior: la reconciliación relee el dueño en cartera y lo mueve
				// con compare-and-set. Review de Codex, PR #1758 y #1765.
				await reconciliarAvisosLlamarCliente([inm.casoCobroId]);
			}
		}
	}

	return { ok: true, modo: resultado.modo, advertencia };
}

/**
 * El ASESOR declara que LEGION ya aplicó el apagado o la reactivación de la
 * unidad, una vez aprobada la solicitud. Adjunta la confirmación de LEGION
 * (archivo y/o nota); en el apagado además la ubicación del vehículo en ese
 * momento. Todo queda en la fila y en el evento `marcar_ejecutada` (quién,
 * cuándo, qué adjuntó).
 *
 * Quien ejecuta tiene que ser quien lleva el crédito en cartera (o un rol con
 * visibilidad completa, que pasa sin consulta): `assertAccesoCasoCobro` más la
 * revalidación SIN cache de cartera. El resto de la ejecución (bucket, vínculo
 * GPS, avisos) está en `ejecutarAprobada`.
 *
 * Fábrica en vez de dos procedures copiados; `ejecutarReactivacion` se exporta
 * aparte del router por el mismo límite de TS7056 que los demás.
 */
function ejecutarPorAsesor(accion: "apagado" | "reactivacion") {
	return cobrosProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				evidencia: z
					.object({
						key: z.string().min(1).max(500),
						nombreArchivo: z.string().trim().min(1).max(255),
					})
					.optional(),
				nota: z.string().trim().max(1000).optional(),
				// Consulta de ubicación hecha al abrir el modal (momento "ejecucion").
				consultaLogId: z.string().uuid().optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			const errorEvidencia = erroresEvidenciaEjecucion({
				evidencia: input.evidencia,
				nota: input.nota,
			});
			if (errorEvidencia) {
				throw new ORPCError("BAD_REQUEST", { message: errorEvidencia });
			}

			const [inm] = await db
				.select()
				.from(inmovilizacionesUnidad)
				.where(eq(inmovilizacionesUnidad.id, input.id))
				.limit(1);
			if (!inm || inm.accion !== accion) {
				throw new ORPCError("NOT_FOUND", {
					message: `Solicitud de ${accion === "apagado" ? "apagado" : "reactivación"} no encontrada.`,
				});
			}
			if (inm.estado !== "aprobada") {
				throw new ORPCError("CONFLICT", {
					message: "La solicitud no está aprobada (o ya fue ejecutada).",
				});
			}

			await assertAccesoCasoCobro(
				inm.casoCobroId,
				context.userId,
				context.userRole,
			);
			await assertCreditoAsignadoEnCarteraPorSifco({
				numeroSifco: inm.numeroCreditoSifco,
				emailUsuario: context.session.user.email,
				userRole: context.userRole,
				accion:
					accion === "apagado"
						? "registrar el apagado de la unidad"
						: "registrar la reactivación de la unidad",
			});

			// La llave la fijó la URL firmada que pidió el navegador
			// (`cobros_inmovilizacion_evidencia` + este caso): una de otro caso o
			// de otro módulo no pasa.
			let evidencia: ExtrasEjecucion["evidencia"] = null;
			if (input.evidencia) {
				const r = await verifyUploadedDocumentInR2({
					key: input.evidencia.key,
					expectedPrefix: buildUploadPrefix(
						"cobros_inmovilizacion_evidencia",
						inm.casoCobroId,
					),
					filename: input.evidencia.nombreArchivo,
					maxSizeBytes: MAX_FILE_SIZE,
				});
				if (
					!(MIME_EVIDENCIA_INMOVILIZACION as readonly string[]).includes(
						r.mimeType,
					)
				) {
					throw new ORPCError("BAD_REQUEST", {
						message: `«${input.evidencia.nombreArchivo}» no es JPG, PNG, WebP ni PDF.`,
					});
				}
				evidencia = {
					key: r.key,
					nombreArchivo: input.evidencia.nombreArchivo,
					mime: r.mimeType,
				};
			}

			// Una falla de Wialon no frena la ejecución (el apagado ya lo hizo
			// LEGION): queda constancia de que no hubo ubicación.
			let ubicacion: UbicacionInmovilizacion | null =
				accion === "apagado"
					? {
							fuente: "sin_ubicacion",
							aviso: "No se consultó la ubicación del vehículo.",
						}
					: null;
			// La reactivación no consulta la ubicación del vehículo.
			if (accion === "apagado" && input.consultaLogId) {
				if (!inm.vehicleId) {
					throw new ORPCError("BAD_REQUEST", {
						message: "La solicitud no tiene un vehículo asociado.",
					});
				}
				const consultada = await leerUbicacionConsulta({
					consultaLogId: input.consultaLogId,
					userId: context.userId,
					vehicleId: inm.vehicleId,
					momento: "ejecucion",
				});
				if (!consultada) {
					throw new ORPCError("BAD_REQUEST", {
						message:
							"La consulta de ubicación venció o no es válida. Actualizá la ubicación del GPS.",
					});
				}
				ubicacion = consultada;
			}

			return ejecutarAprobada(
				{
					id: input.id,
					extras: { evidencia, nota: input.nota || null, ubicacion },
				},
				context,
			);
		});
}

export const inmovilizacionUnidadRouter = {
	/**
	 * Historial de inmovilizaciones del caso + estado derivado de la unidad +
	 * si hay una llamada pendiente por registrar. La Ficha 360 arma el card
	 * completo con esto solo.
	 */
	getInmovilizacionesCaso: cobrosProcedure
		.input(z.object({ casoCobroId: z.string().uuid() }))
		.handler(
			async ({
				input,
				context,
			}): Promise<{
				estadoUnidad: ReturnType<typeof estadoUnidad>;
				solicitudAbierta: FilaInmovilizacionCarta | null;
				pendienteLlamar: FilaInmovilizacion | null;
				pendienteLlamarReactivacion: FilaInmovilizacion | null;
				historial: FilaInmovilizacionCarta[];
				tieneGps: boolean;
			}> => {
				await assertAccesoCasoCobro(
					input.casoCobroId,
					context.userId,
					context.userRole,
				);
				// Si cartera reasignó el crédito, el aviso de "llamar al cliente"
				// pasa al dueño de hoy antes de pintar la tarjeta.
				await reconciliarAvisosLlamarCliente([input.casoCobroId]);

				// El card (solicitudAbierta, pendienteLlamar, el historial que se
				// LISTA) es siempre del caso — nunca se mezclan filas de otro caso
				// en la UI. Solo estadoUnidad usa la unidad física completa: sin
				// esto, un apagado ejecutado desde OTRO caso sobre la misma unidad
				// (D-10) no se reflejaba acá, y el card mostraba "Activa" aunque la
				// unidad estuviera apagada. Review de Codex, PR #1758.
				const [historial, caso] = await Promise.all([
					getHistorialCaso(input.casoCobroId),
					getCasoParaInmovilizacion(input.casoCobroId),
				]);
				const historialUnidadFisica = await getHistorialUnidadFisica(
					input.casoCobroId,
					caso?.wialonUnitId ?? null,
				);
				const historialParaEstado: InmovilizacionHistorialItem[] =
					historialUnidadFisica.map((h) => ({
						accion: h.accion,
						estado: h.estado,
						ejecutadoAt: h.ejecutadoAt,
					}));

				const historialCarta = await enriquecerFilasCarta(historial);
				const solicitudAbierta =
					historialCarta.find(
						(h) =>
							h.estado === "pendiente_aprobacion" || h.estado === "aprobada",
					) ?? null;

				// Solo mientras la unidad SIGA apagada: si ya se reactivó (p. ej. el
				// cliente pagó por ventanilla y se pidió la reactivación directa), el
				// apagado viejo sin llamada ya no es una tarea pendiente.
				//
				// La fila vigente se busca en la UNIDAD FÍSICA (no en `historial`,
				// que es solo de este caso): con una unidad compartida (D-10), el
				// apagado/reactivación más reciente pudo haberse ejecutado desde
				// OTRO caso. Buscar en `historial` encontraba el apagado VIEJO de
				// ESTE caso (si lo tenía) en vez de `null`, y el asesor completaba
				// una llamada sobre un apagado ya superado por eventos posteriores.
				// Si la fila vigente es de otro caso, se suprime: este caso no
				// puede enlazarle una llamada a una fila que no es suya. Review de
				// Codex, PR #1758.
				const estado = estadoUnidad(historialParaEstado);
				const apagadoVigente =
					estado === "inmovilizada"
						? ultimaEjecutada(historialUnidadFisica, "apagado")
						: null;
				const pendienteLlamar =
					apagadoVigente &&
					apagadoVigente.llamadaContactoId === null &&
					apagadoVigente.casoCobroId === input.casoCobroId
						? apagadoVigente
						: null;

				// Misma idea que pendienteLlamar pero en espejo: la última
				// reactivación ejecutada, mientras la unidad siga ACTIVA (si ya
				// se volvió a apagar, esa llamada vieja no es tarea pendiente).
				const reactivacionVigente =
					estado === "activa"
						? ultimaEjecutada(historialUnidadFisica, "reactivacion")
						: null;
				const pendienteLlamarReactivacion =
					reactivacionVigente &&
					reactivacionVigente.llamadaContactoId === null &&
					reactivacionVigente.casoCobroId === input.casoCobroId
						? reactivacionVigente
						: null;

				return {
					estadoUnidad: estado,
					solicitudAbierta,
					pendienteLlamar,
					pendienteLlamarReactivacion,
					historial: historialCarta,
					tieneGps: caso?.wialonUnitId != null,
				};
			},
		),

	/**
	 * Ubicación actual del vehículo a inmovilizar, desde Wialon. La piden el
	 * modal de solicitud y el de ejecución. Cada consulta queda auditada en
	 * `gps_consulta_logs` ANTES de llamar a Wialon (CB-118) y su resultado, en
	 * el snapshot; `consultaLogId` es lo que después se adjunta a la
	 * solicitud/ejecución (el server relee ahí la ubicación, no confía en el
	 * cliente).
	 *
	 * No usa `getGpsVehiculo`: ese valida el vehículo contra la oportunidad,
	 * y la inmovilización resuelve la unidad desde el contrato (ver el
	 * comentario de la carta en la Ficha 360). Una falla de Wialon NO lanza:
	 * devuelve `no_disponible` para que el asesor pueda seguir (con la
	 * dirección escrita a mano al solicitar, o con aviso al ejecutar).
	 */
	getUbicacionInmovilizacion: cobrosProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
				momento: z.enum(["solicitud", "ejecucion"]),
			}),
		)
		.handler(
			async ({
				input,
				context,
			}): Promise<{
				estado: "ok" | "sin_posicion" | "no_disponible";
				consultaLogId: string | null;
				ubicacion: UbicacionInmovilizacion | null;
				mensaje: string | null;
			}> => {
				await assertAccesoCasoCobro(
					input.casoCobroId,
					context.userId,
					context.userRole,
				);
				const caso = await getCasoParaInmovilizacion(input.casoCobroId);
				if (!caso?.numeroCreditoSifco || !caso.vehicleId) {
					throw new ORPCError("BAD_REQUEST", {
						message: "El caso no tiene un vehículo asociado.",
					});
				}
				if (caso.wialonUnitId == null) {
					throw new ORPCError("BAD_REQUEST", {
						message: "El vehículo asociado no tiene una unidad GPS vinculada.",
					});
				}
				await assertCreditoAsignadoEnCarteraPorSifco({
					numeroSifco: caso.numeroCreditoSifco,
					emailUsuario: context.session.user.email,
					userRole: context.userRole,
					accion: "ver la ubicación GPS de este vehículo",
				});

				const vehicleId = caso.vehicleId;
				const unitId = caso.wialonUnitId;
				const unitName = caso.wialonUnitName ?? String(unitId);

				// Auditoría primero: sin fila no se muestra ubicación (fail closed,
				// mismo criterio que `AUDITORIA_NO_DISPONIBLE` en getGpsVehiculo).
				let consultaLogId: string;
				try {
					const [fila] = await db
						.insert(gpsConsultaLogs)
						.values({
							vehicleId,
							numeroCreditoSifco: caso.numeroCreditoSifco,
							motivo: MOTIVO_CONSULTA_UBICACION[input.momento],
							unitId: String(unitId),
							unitName,
							origen: origenConsultaUbicacion(input.momento),
							userId: context.userId,
						})
						.returning({ id: gpsConsultaLogs.id });
					consultaLogId = fila.id;
				} catch (error) {
					console.error("GPS_CONSULTA_LOG_FALLIDO", {
						vehicleId,
						message: error instanceof Error ? error.message : String(error),
					});
					return {
						estado: "no_disponible",
						consultaLogId: null,
						ubicacion: null,
						mensaje:
							"No se pudo registrar la consulta; por seguridad no se muestra la ubicación. Intentá de nuevo.",
					};
				}

				let snapshot: Record<string, unknown>;
				try {
					const { status, fechas } = await conContextoGps(
						{
							origen: "getUbicacionInmovilizacion",
							userId: context.userId,
							vehicleId,
							numeroCreditoSifco: caso.numeroCreditoSifco,
						},
						async () => {
							enlazarConsultaLogEnContexto(consultaLogId);
							const client = getWialonClient();
							const [statusList, tiempos] = await Promise.all([
								client.getUnitsStatus([unitId]),
								client.getUnitLastTimes(unitId).catch(() => ({
									ultimoMensajeAt: null,
									ultimaPosicionAt: null,
								})),
							]);
							return { status: statusList[0], fechas: tiempos };
						},
					);
					snapshot = {
						estado: "vinculado",
						auditada: true,
						unitId,
						unitName,
						vinculoOrigen: "persistido",
						placa: null,
						telemetria: {
							mileageKm: status?.mileageKm,
							mileageFormatted: status?.mileageFormatted,
							engineHours: status?.engineHours,
							engineHoursFormatted: status?.engineHoursFormatted,
							speedKmh: status?.speedKmh,
							latitude: status?.latitude,
							longitude: status?.longitude,
							isIgnitionOn: status?.isIgnitionOn,
							ultimaSenalAt: fechas.ultimoMensajeAt,
							ultimaPosicionAt: fechas.ultimaPosicionAt,
						},
					};
				} catch (error) {
					console.error("GPS_UBICACION_INMOVILIZACION_ERROR", {
						vehicleId,
						code: error instanceof WialonClientError ? error.code : undefined,
						message: error instanceof Error ? error.message : String(error),
					});
					snapshot = {
						estado: "no_disponible",
						auditada: true,
						error: {
							code:
								error instanceof WialonClientError
									? error.code
									: "ERROR_INTERNO",
							message:
								error instanceof WialonClientError
									? mensajeUsuarioWialon(error)
									: "No se pudo consultar el GPS del vehículo. Intente de nuevo.",
						},
						referencia: null,
					};
				}

				// Mismo criterio que getGpsVehiculo: el snapshot es best-effort, la
				// auditoría ya quedó. El mismo objeto se relee después al adjuntar la
				// consulta, así que si no se guarda la ubicación no se puede adjuntar.
				try {
					await db
						.update(gpsConsultaLogs)
						.set({ snapshot })
						.where(eq(gpsConsultaLogs.id, consultaLogId));
				} catch (error) {
					console.error("GPS_CONSULTA_SNAPSHOT_FALLIDO", {
						vehicleId,
						message: error instanceof Error ? error.message : String(error),
					});
				}

				const ubicacion = ubicacionDesdeSnapshot(
					snapshot,
					consultaLogId,
					unitName,
				);
				if (ubicacion.fuente === "gps") {
					return { estado: "ok", consultaLogId, ubicacion, mensaje: null };
				}
				return {
					estado:
						(snapshot as { estado?: string }).estado === "vinculado"
							? "sin_posicion"
							: "no_disponible",
					consultaLogId,
					ubicacion,
					mensaje: ubicacion.aviso ?? null,
				};
			},
		),

	/**
	 * Solicita el apagado o la reactivación de la unidad del caso.
	 *
	 * Misma cadena de autorización que `enviarCreditoARecuperacion`
	 * (routers/cobros.ts): el crédito no se recibe suelto del cliente
	 * (sale del caso), y `assertCreditoAsignadoEnCarteraPorSifco` revalida
	 * SIN cache que el crédito sigue siendo del asesor que pide — entre
	 * autorizar y escribir alguien más pudo habérselo reasignado.
	 */
	solicitarInmovilizacion: cobrosProcedure
		.input(
			z.object({
				casoCobroId: z.string().uuid(),
				accion: z.enum(["apagado", "reactivacion"]),
				// Reactivación: qué pasó, el pago que lo respalda (si aplica) y detalle.
				quePaso: z.enum(CLAVES_QUE_PASO_REACTIVACION).optional(),
				pagoId: z.number().int().positive().optional(),
				// Apagado: motivos del catálogo + detalle + dónde está el vehículo.
				motivos: z.array(z.string().min(1).max(60)).max(12).optional(),
				motivoDetalle: z.string().trim().max(2000).optional(),
				ubicacion: z
					.object({
						consultaLogId: z.string().uuid().optional(),
						direccion: z.string().trim().max(500).optional(),
						enlace: z.string().trim().max(1000).optional(),
					})
					.optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			// Lo que depende solo del input se valida antes de tocar la base.
			let motivoTexto: string;
			if (input.accion === "apagado") {
				const errorMotivos = erroresMotivosInmovilizacion(
					input.motivos ?? [],
					input.motivoDetalle,
				);
				if (errorMotivos) {
					throw new ORPCError("BAD_REQUEST", { message: errorMotivos });
				}
				if (
					input.ubicacion?.enlace &&
					!/^https?:\/\//i.test(input.ubicacion.enlace)
				) {
					throw new ORPCError("BAD_REQUEST", {
						message: "El enlace tiene que empezar con http:// o https://",
					});
				}
				const errorUbicacion = erroresUbicacionSolicitud(input.ubicacion ?? {});
				if (errorUbicacion) {
					throw new ORPCError("BAD_REQUEST", { message: errorUbicacion });
				}
				motivoTexto = componerMotivoApagado(
					input.motivos ?? [],
					input.motivoDetalle,
				);
			} else {
				if (!input.quePaso) {
					throw new ORPCError("BAD_REQUEST", {
						message: "Elegí qué pasó: pago, promesa de pago o 50% + promesa.",
					});
				}
				motivoTexto = componerMotivoReactivacion(
					input.quePaso,
					input.motivoDetalle,
				);
			}

			await assertAccesoCasoCobro(
				input.casoCobroId,
				context.userId,
				context.userRole,
			);

			const caso = await getCasoParaInmovilizacion(input.casoCobroId);
			if (!caso?.numeroCreditoSifco) {
				throw new ORPCError("BAD_REQUEST", {
					message: "El caso no tiene crédito de cartera asociado.",
				});
			}
			// El front no muestra la carta sin vehicleId ($id.tsx), pero eso no
			// alcanza como gate: un llamado directo al endpoint podía crear una
			// solicitud de "apagar" sin unidad real. Review de Codex.
			if (!caso.vehicleId) {
				throw new ORPCError("BAD_REQUEST", {
					message: "El caso no tiene un vehículo asociado para inmovilizar.",
				});
			}
			const vehicleId = caso.vehicleId;

			// El vehículo debe tener una unidad GPS vinculada para poder inmovilizar:
			// sin wialonUnitId no hay unidad física sobre la cual actuar ni auditar.
			// Review de Codex.
			if (caso.wialonUnitId == null) {
				throw new ORPCError("BAD_REQUEST", {
					message: "El vehículo asociado no tiene una unidad GPS vinculada.",
				});
			}
			const wialonUnitId = caso.wialonUnitId;

			// Apagado: la ubicación sale de una consulta GPS auditada (se relee
			// acá, no se confía en lo que mande el cliente) o, si Wialon no
			// respondió, de la dirección/enlace que escribió el asesor.
			let ubicacionSolicitud: UbicacionInmovilizacion | null = null;
			if (input.accion === "apagado") {
				const consultada = input.ubicacion?.consultaLogId
					? await leerUbicacionConsulta({
							consultaLogId: input.ubicacion.consultaLogId,
							userId: context.userId,
							vehicleId,
							momento: "solicitud",
						})
					: null;
				if (input.ubicacion?.consultaLogId && !consultada) {
					throw new ORPCError("BAD_REQUEST", {
						message:
							"La consulta de ubicación venció o no es válida. Actualizá la ubicación del GPS.",
					});
				}
				const direccion = input.ubicacion?.direccion || null;
				const enlace = input.ubicacion?.enlace || null;
				if (consultada?.fuente === "gps") {
					ubicacionSolicitud = { ...consultada, direccion, enlace };
				} else if (direccion || enlace) {
					ubicacionSolicitud = {
						fuente: "manual",
						direccion,
						enlace,
						consultaLogId: consultada?.consultaLogId ?? null,
						unidad: consultada?.unidad ?? null,
						aviso: consultada?.aviso ?? null,
					};
				} else {
					throw new ORPCError("BAD_REQUEST", {
						message:
							"El GPS no devolvió la ubicación: escribí la dirección o el enlace del vehículo.",
					});
				}
			}

			await assertCreditoAsignadoEnCarteraPorSifco({
				numeroSifco: caso.numeroCreditoSifco,
				emailUsuario: context.session.user.email,
				userRole: context.userRole,
				accion:
					input.accion === "apagado"
						? "solicitar el apagado de la unidad"
						: "solicitar la reactivación de la unidad",
			});

			let bucket: number | null = null;
			if (isCarteraBackEnabled()) {
				try {
					const bucketActual = await carteraBackClient.getBucketActualCredito(
						caso.numeroCreditoSifco,
					);
					bucket = bucketActual?.bucket ?? null;
				} catch (error) {
					// Fail closed: si no se puede confirmar el bucket, NO se
					// habilita la acción (mismo criterio que ubicaciones-clave.ts
					// para B4) — bucket queda null y puedeSolicitar lo rechaza.
					console.error(
						"[solicitarInmovilizacion] No se pudo resolver el bucket:",
						error,
					);
				}
			}

			// Estado de la UNIDAD FÍSICA (no solo de este caso): ver
			// getHistorialUnidadFisica. `origenId` (abajo) sigue buscando el
			// apagado en el historial de la unidad física, no solo del caso —
			// mismo motivo: si el apagado se ejecutó desde otro caso B4 sobre
			// la misma unidad, esta reactivación tiene que poder cerrarlo.
			const historial = await getHistorialUnidadFisica(
				input.casoCobroId,
				caso.wialonUnitId,
			);
			const estadoActual = estadoUnidad(
				historial.map((h) => ({
					accion: h.accion,
					estado: h.estado,
					ejecutadoAt: h.ejecutadoAt,
				})),
			);

			if (!puedeSolicitar(input.accion, estadoActual, bucket)) {
				let message: string;
				if (input.accion === "reactivacion") {
					message =
						"La unidad no está inmovilizada: no hay nada que reactivar.";
				} else if (estadoActual === "inmovilizada") {
					message = "La unidad ya está inmovilizada.";
				} else if (bucket == null) {
					message =
						"No se pudo confirmar el bucket del crédito. Intentá de nuevo en unos minutos.";
				} else {
					message = `El apagado aplica a créditos en ${bucketsInmovilizacionTexto()} y este está en B${bucket}.`;
				}
				throw new ORPCError("BAD_REQUEST", { message });
			}

			// Reactivación: el respaldo (pago y/o promesa) se verifica contra
			// cartera y contra las gestiones del caso, no contra el navegador.
			let respaldoReactivacion: RespaldoReactivacion | null = null;
			if (input.accion === "reactivacion" && input.quePaso) {
				const apagadoVigente = ultimaEjecutada(historial, "apagado");
				if (!apagadoVigente?.ejecutadoAt) {
					throw new ORPCError("BAD_REQUEST", {
						message: "No se encontró el apagado que se quiere revertir.",
					});
				}
				respaldoReactivacion = await resolverRespaldoReactivacion({
					quePaso: input.quePaso,
					pagoId: input.pagoId,
					casoCobroId: input.casoCobroId,
					numeroCreditoSifco: caso.numeroCreditoSifco,
					apagadoEjecutadoAt: apagadoVigente.ejecutadoAt,
				});
			}

			// La reactivación también apunta al apagado que revierte, para que al
			// ejecutarse ese apagado quede con resultado = 'reactivada'.
			const origenId =
				input.accion === "reactivacion"
					? (ultimaEjecutada(historial, "apagado")?.id ?? null)
					: null;

			let inmovilizacionId: string;
			try {
				inmovilizacionId = await db.transaction(async (tx) => {
					await bloquearUnidadFisica(tx, {
						casoCobroId: input.casoCobroId,
						wialonUnitId,
					});

					// Re-validar la vinculación Wialon del vehículo bajo lock: si el
					// GPS fue reasignado a otro vehículo o desvinculado entre la
					// lectura de `getCasoParaInmovilizacion` y la adquisición del lock
					// (por ejemplo, vía `reasignarUnidad` en `routers/wialon.ts`),
					// continuar con el `caso.wialonUnitId` obsoleto registraría la
					// solicitud contra la unidad física anterior, afectando al nuevo
					// vehículo y dejando al caso actual desincronizado.
					const [vehiculoTx] = await tx
						.select({ wialonUnitId: vehicles.wialonUnitId })
						.from(vehicles)
						.where(eq(vehicles.id, vehicleId))
						.for("update")
						.limit(1);

					if (!vehiculoTx) {
						throw new ORPCError("CONFLICT", {
							message: "El vehículo ya no existe o fue desasociado.",
						});
					}

					if (vehiculoTx.wialonUnitId == null) {
						throw new ORPCError("CONFLICT", {
							message:
								"El vehículo asociado no tiene una unidad GPS vinculada.",
						});
					}

					if (vehiculoTx.wialonUnitId !== wialonUnitId) {
						throw new ORPCError("CONFLICT", {
							message:
								"La unidad GPS del vehículo cambió durante la solicitud. Por favor intentá de nuevo.",
						});
					}

					// Re-validar estado bajo lock: entre la lectura temprana fuera
					// de transacción y la adquisición del advisory lock, otro caso
					// compartiendo la misma unidad física pudo haber completado la
					// acción opuesta (ejecutarAprobada). Re-leer el historial bajo
					// lock garantiza que el estado y el origenId sean los reales.
					const historialTx = await getHistorialUnidadFisicaTx(tx)(
						input.casoCobroId,
						vehiculoTx.wialonUnitId,
					);
					const estadoActualTx = estadoUnidad(
						historialTx.map((h) => ({
							accion: h.accion,
							estado: h.estado,
							ejecutadoAt: h.ejecutadoAt,
						})),
					);

					if (!puedeSolicitar(input.accion, estadoActualTx, bucket)) {
						let message: string;
						if (input.accion === "reactivacion") {
							message =
								"La unidad no está inmovilizada: no hay nada que reactivar.";
						} else if (estadoActualTx === "inmovilizada") {
							message = "La unidad ya está inmovilizada.";
						} else if (bucket == null) {
							message =
								"No se pudo confirmar el bucket del crédito. Intentá de nuevo en unos minutos.";
						} else {
							message = `El apagado aplica a créditos en ${bucketsInmovilizacionTexto()} y este está en B${bucket}.`;
						}
						throw new ORPCError("CONFLICT", { message });
					}

					const origenIdTx =
						input.accion === "reactivacion"
							? (ultimaEjecutada(historialTx, "apagado")?.id ?? null)
							: null;

					const [fila] = await tx
						.insert(inmovilizacionesUnidad)
						.values({
							casoCobroId: input.casoCobroId,
							numeroCreditoSifco: caso.numeroCreditoSifco as string,
							vehicleId: caso.vehicleId,
							wialonUnitId: vehiculoTx.wialonUnitId,
							accion: input.accion,
							motivo: motivoTexto,
							motivos: input.accion === "apagado" ? input.motivos : null,
							motivoDetalle: input.motivoDetalle || null,
							quePaso: input.accion === "reactivacion" ? input.quePaso : null,
							respaldoReactivacion,
							ubicacionSolicitud,
							bucketSnapshot: bucket,
							solicitadoPor: context.userId,
							inmovilizacionOrigenId: origenIdTx,
						})
						.returning({ id: inmovilizacionesUnidad.id });

					await tx.insert(inmovilizacionesUnidadEventos).values({
						inmovilizacionId: fila.id,
						evento: "solicitar",
						estadoNuevo: "pendiente_aprobacion",
						usuarioId: context.userId,
						detalle: {
							accion: input.accion,
							motivo: motivoTexto,
							motivos: input.accion === "apagado" ? input.motivos : undefined,
							quePaso: input.quePaso,
							respaldo: respaldoReactivacion ?? undefined,
							ubicacion: ubicacionSolicitud ?? undefined,
						},
					});

					return fila.id;
				});
			} catch (error) {
				// El índice único parcial (caso_cobro_id) WHERE estado IN
				// (pendiente_aprobacion, aprobada) es la protección real bajo
				// concurrencia — dos solicitudes simultáneas sobre el mismo caso
				// no pueden pasar ambas. Cualquier OTRO error sale tal cual.
				if (esViolacionUnica(error)) {
					throw new ORPCError("CONFLICT", {
						message:
							"Ya hay una solicitud de inmovilización abierta para este caso.",
					});
				}
				throw error;
			}

			await notificarInmovilizacionPendiente({
				inmovilizacionId,
				casoCobroId: input.casoCobroId,
				accion: input.accion,
				clienteNombre: caso.clienteNombre ?? undefined,
				numeroCreditoSifco: caso.numeroCreditoSifco,
				motivo: motivoTexto,
				solicitadoPorUserId: context.userId,
				solicitadoPorRole: context.userRole,
			});

			return { id: inmovilizacionId };
		}),

	/**
	 * Cancela una solicitud abierta. Mientras está `pendiente_aprobacion` solo
	 * la retira quien la pidió. Un APAGADO ya aprobado lo retira quien puede
	 * ejecutarlo (mismo acceso que `ejecutarApagado`): si LEGION no lo aplica o
	 * ya no corresponde, sin esto la solicitud quedaba `aprobada` para siempre,
	 * bloqueando nuevas solicitudes del caso y con un recordatorio diario que
	 * nadie podía cerrar (review de Codex, PR #1807).
	 */
	cancelarSolicitud: cobrosProcedure
		.input(z.object({ id: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const [previa] = await db
				.select({
					accion: inmovilizacionesUnidad.accion,
					estado: inmovilizacionesUnidad.estado,
					casoCobroId: inmovilizacionesUnidad.casoCobroId,
					numeroCreditoSifco: inmovilizacionesUnidad.numeroCreditoSifco,
				})
				.from(inmovilizacionesUnidad)
				.where(eq(inmovilizacionesUnidad.id, input.id))
				.limit(1);

			const cancelaApagadoAprobado =
				previa?.accion === "apagado" && previa.estado === "aprobada";
			if (cancelaApagadoAprobado) {
				await assertAccesoCasoCobro(
					previa.casoCobroId,
					context.userId,
					context.userRole,
				);
				await assertCreditoAsignadoEnCarteraPorSifco({
					numeroSifco: previa.numeroCreditoSifco,
					emailUsuario: context.session.user.email,
					userRole: context.userRole,
					accion: "cancelar el apagado aprobado de la unidad",
				});
			}
			const estadoAnterior = cancelaApagadoAprobado
				? ("aprobada" as const)
				: ("pendiente_aprobacion" as const);

			const cancelada = await db.transaction(async (tx) => {
				const [fila] = await tx
					.update(inmovilizacionesUnidad)
					.set({ estado: "cancelada", updatedAt: new Date() })
					.where(
						and(
							eq(inmovilizacionesUnidad.id, input.id),
							eq(inmovilizacionesUnidad.estado, estadoAnterior),
							cancelaApagadoAprobado
								? eq(inmovilizacionesUnidad.accion, "apagado")
								: eq(inmovilizacionesUnidad.solicitadoPor, context.userId),
						),
					)
					.returning({ id: inmovilizacionesUnidad.id });
				if (!fila) return false;

				await tx.insert(inmovilizacionesUnidadEventos).values({
					inmovilizacionId: input.id,
					evento: "cancelar",
					estadoAnterior,
					estadoNuevo: "cancelada",
					usuarioId: context.userId,
				});
				return true;
			});

			if (!cancelada) {
				throw new ORPCError("CONFLICT", {
					message:
						"La solicitud ya no se puede cancelar (ya se decidió o ejecutó), o no te pertenece.",
				});
			}

			// Los supervisores ya no tienen nada que decidir: sin esto seguían
			// viendo el aviso y al abrirlo chocaban con un CONFLICT. Y el
			// recordatorio de "falta ejecutarlo" deja de aplicar.
			await resolverPendientesInmovilizacion(input.id);
			await resolverRecordatoriosEjecucion(input.id);

			return { ok: true };
		}),

	/**
	 * Cola del supervisor: solicitudes pendientes de aprobación Y aprobadas
	 * (por ejecutar) — la web las separa en dos secciones por `estado`.
	 */
	getColaInmovilizaciones: cobrosSupervisorProcedure.handler(async () => {
		return db
			.select({
				id: inmovilizacionesUnidad.id,
				casoCobroId: inmovilizacionesUnidad.casoCobroId,
				numeroCreditoSifco: inmovilizacionesUnidad.numeroCreditoSifco,
				accion: inmovilizacionesUnidad.accion,
				estado: inmovilizacionesUnidad.estado,
				motivo: inmovilizacionesUnidad.motivo,
				quePaso: inmovilizacionesUnidad.quePaso,
				respaldoReactivacion: inmovilizacionesUnidad.respaldoReactivacion,
				ubicacionSolicitud: inmovilizacionesUnidad.ubicacionSolicitud,
				bucketSnapshot: inmovilizacionesUnidad.bucketSnapshot,
				solicitadoAt: inmovilizacionesUnidad.solicitadoAt,
				solicitanteNombre: user.name,
				clienteNombre: clients.contactPerson,
			})
			.from(inmovilizacionesUnidad)
			.innerJoin(user, eq(inmovilizacionesUnidad.solicitadoPor, user.id))
			.leftJoin(
				casosCobros,
				eq(inmovilizacionesUnidad.casoCobroId, casosCobros.id),
			)
			.leftJoin(
				contratosFinanciamiento,
				eq(casosCobros.contratoId, contratosFinanciamiento.id),
			)
			.leftJoin(clients, eq(contratosFinanciamiento.clientId, clients.id))
			.where(
				inArray(inmovilizacionesUnidad.estado, [
					"pendiente_aprobacion",
					"aprobada",
				]),
			)
			.orderBy(desc(inmovilizacionesUnidad.solicitadoAt));
	}),

	/**
	 * El supervisor aprueba o rechaza. `UPDATE ... WHERE estado =
	 * 'pendiente_aprobacion' RETURNING` es la garantía de "un solo supervisor
	 * decide" bajo concurrencia — si no devuelve filas, otro ya decidió.
	 */
	decidirInmovilizacion: cobrosSupervisorProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				decision: z.enum(["aprobar", "rechazar"]),
				motivoRechazo: z.string().trim().min(5).max(1000).optional(),
			}),
		)
		.handler(async ({ input, context }) => {
			if (input.decision === "rechazar" && !input.motivoRechazo) {
				throw new ORPCError("BAD_REQUEST", {
					message: "El rechazo requiere un motivo de al menos 5 caracteres.",
				});
			}

			const nuevoEstado =
				input.decision === "aprobar" ? "aprobada" : "rechazada";

			// Aprobar un apagado es el último control antes de pedirle a LEGION que
			// lo aplique: el crédito tiene que seguir en B2-B4 (si el cliente ya
			// pagó, no se apaga). Falla cerrado: sin poder confirmar el bucket no
			// se aprueba. Después de aplicado ya no se cancela (ver `ejecutarAprobada`).
			if (input.decision === "aprobar" && isCarteraBackEnabled()) {
				const [pendiente] = await db
					.select()
					.from(inmovilizacionesUnidad)
					.where(eq(inmovilizacionesUnidad.id, input.id))
					.limit(1);
				if (pendiente?.accion === "apagado") {
					let bucket: number | null = null;
					try {
						const actual = await carteraBackClient.getBucketActualCredito(
							pendiente.numeroCreditoSifco,
						);
						bucket = actual?.bucket ?? null;
					} catch (error) {
						console.error(
							"[decidirInmovilizacion] No se pudo resolver el bucket:",
							error,
						);
					}
					if (bucket == null) {
						throw new ORPCError("CONFLICT", {
							message:
								"No se pudo confirmar el bucket del crédito en cartera. Intentá de nuevo en unos minutos.",
						});
					}
					if (!BUCKETS_INMOVILIZACION.includes(bucket)) {
						throw new ORPCError("CONFLICT", {
							message: `El crédito ya no está en ${bucketsInmovilizacionTexto()} (está en B${bucket}): el apagado ya no aplica. Rechazá la solicitud.`,
						});
					}
				}
			}

			const actualizada = await db.transaction(async (tx) => {
				const [fila] = await tx
					.update(inmovilizacionesUnidad)
					.set({
						estado: nuevoEstado,
						decididoPor: context.userId,
						decididoAt: new Date(),
						motivoRechazo:
							input.decision === "rechazar" ? input.motivoRechazo : null,
						updatedAt: new Date(),
					})
					.where(
						and(
							eq(inmovilizacionesUnidad.id, input.id),
							eq(inmovilizacionesUnidad.estado, "pendiente_aprobacion"),
						),
					)
					.returning({
						id: inmovilizacionesUnidad.id,
						casoCobroId: inmovilizacionesUnidad.casoCobroId,
						accion: inmovilizacionesUnidad.accion,
						solicitadoPor: inmovilizacionesUnidad.solicitadoPor,
						numeroCreditoSifco: inmovilizacionesUnidad.numeroCreditoSifco,
					});
				if (!fila) return null;

				await tx.insert(inmovilizacionesUnidadEventos).values({
					inmovilizacionId: input.id,
					evento: input.decision,
					estadoAnterior: "pendiente_aprobacion",
					estadoNuevo: nuevoEstado,
					usuarioId: context.userId,
					detalle:
						input.decision === "rechazar"
							? { motivoRechazo: input.motivoRechazo }
							: null,
				});
				return fila;
			});

			if (!actualizada) {
				throw new ORPCError("CONFLICT", {
					message: "Otro supervisor ya decidió esta solicitud.",
				});
			}

			await notificarInmovilizacionResuelta({
				inmovilizacionId: actualizada.id,
				casoCobroId: actualizada.casoCobroId,
				numeroCreditoSifco: actualizada.numeroCreditoSifco,
				accion: actualizada.accion,
				decision: nuevoEstado,
				motivoRechazo: input.motivoRechazo,
				solicitanteUserId: actualizada.solicitadoPor,
				decididoPorUserId: context.userId,
				decididoPorRole: context.userRole,
			});

			return { ok: true };
		}),

	ejecutarApagado: ejecutarPorAsesor("apagado"),
};

/**
 * Confirma que el asesor ya llamó al cliente tras una REACTIVACIÓN
 * ejecutada. Simétrico a `registrarLlamadaApagado`: no hay siguiente paso
 * que decidir, solo cerrar el ciclo dejando constancia de la gestión.
 *
 * Aparte de `inmovilizacionUnidadRouter` (no como una propiedad más) y
 * re-exportado por inmovilizacion-reactivacion-llamada.ts: agregarlo ahí
 * empujaba ese objeto sobre el límite de TS7056 — mismo problema que ya
 * describe el comentario del encabezado de este archivo.
 */
export const registrarLlamadaReactivacion = cobrosProcedure
	.input(
		z.object({
			inmovilizacionId: z.string().uuid(),
			contactoId: z.string().uuid(),
		}),
	)
	.handler(async ({ input, context }) => {
		const [inm] = await db
			.select()
			.from(inmovilizacionesUnidad)
			.where(
				and(
					eq(inmovilizacionesUnidad.id, input.inmovilizacionId),
					eq(inmovilizacionesUnidad.accion, "reactivacion"),
					eq(inmovilizacionesUnidad.estado, "ejecutada"),
				),
			)
			.limit(1);

		if (!inm) {
			throw new ORPCError("BAD_REQUEST", {
				message: "No hay una reactivación ejecutada con ese id.",
			});
		}

		await assertAccesoLlamadaInmovilizacion(
			inm,
			context.userId,
			context.userRole,
		);

		if (inm.llamadaContactoId !== null) {
			throw new ORPCError("CONFLICT", {
				message: "Esta llamada ya se registró.",
			});
		}

		// Chequeo temprano SIN lock (mensaje claro rápido); el re-chequeo CON
		// lock dentro de la transacción es la garantía real bajo concurrencia
		// — ver comentario de `filaSigueVigente`. Review de Codex, PR #1758.
		if (!(await filaSigueVigente(inm, getHistorialUnidadFisica))) {
			throw new ORPCError("CONFLICT", {
				message:
					"Esta reactivación ya no es la vigente de la unidad: fue superada por un ciclo más reciente.",
			});
		}

		// Mismo guard que registrarLlamadaApagado: MISMO caso, una LLAMADA
		// posterior a la ejecución (no cualquier gestión vieja o de otro
		// canal), y no enlazada ya a otra inmovilización. Review de Codex, PR
		// #1758.
		const [contacto] = await db
			.select({
				id: contactosCobros.id,
				inmovilizacionId: contactosCobros.inmovilizacionId,
			})
			.from(contactosCobros)
			.where(
				and(
					eq(contactosCobros.id, input.contactoId),
					eq(contactosCobros.casoCobroId, inm.casoCobroId),
					eq(contactosCobros.metodoContacto, "llamada"),
					gt(contactosCobros.fechaContacto, inm.ejecutadoAt ?? new Date(0)),
				),
			)
			.limit(1);
		if (!contacto) {
			throw new ORPCError("BAD_REQUEST", {
				message:
					"El contacto indicado no es una llamada registrada después de la reactivación.",
			});
		}
		if (contacto.inmovilizacionId !== null) {
			throw new ORPCError("CONFLICT", {
				message:
					"Esa gestión ya está registrada como la llamada de otra inmovilización.",
			});
		}

		await db.transaction(async (tx) => {
			// Mismo criterio que registrarLlamadaApagado: advisory lock por
			// unidad PRIMERO (serializa contra ejecutarAprobada, evita el
			// deadlock de locks de fila cruzados — review de Codex, PR #1758,
			// ver `bloquearUnidadFisica`), y el SELECT ... FOR UPDATE de esta
			// fila como defensa adicional antes de re-verificar que sigue
			// siendo la vigente.
			await bloquearUnidadFisica(tx, {
				casoCobroId: inm.casoCobroId,
				wialonUnitId: inm.wialonUnitId,
			});
			await tx
				.select({ id: inmovilizacionesUnidad.id })
				.from(inmovilizacionesUnidad)
				.where(eq(inmovilizacionesUnidad.id, inm.id))
				.for("update");
			if (!(await filaSigueVigente(inm, getHistorialUnidadFisicaTx(tx)))) {
				throw new ORPCError("CONFLICT", {
					message:
						"Esta reactivación ya no es la vigente de la unidad: fue superada por un ciclo más reciente.",
				});
			}

			// Mismo criterio que registrarLlamadaApagado: los UPDATE
			// condicionados a IS NULL son la garantía bajo concurrencia.
			const [reactivacion] = await tx
				.update(inmovilizacionesUnidad)
				.set({ llamadaContactoId: input.contactoId, updatedAt: new Date() })
				.where(
					and(
						eq(inmovilizacionesUnidad.id, inm.id),
						isNull(inmovilizacionesUnidad.llamadaContactoId),
					),
				)
				.returning({ id: inmovilizacionesUnidad.id });
			if (!reactivacion) {
				throw new ORPCError("CONFLICT", {
					message: "Esta llamada ya se registró.",
				});
			}

			const [enlazado] = await tx
				.update(contactosCobros)
				.set({ inmovilizacionId: inm.id })
				.where(
					and(
						eq(contactosCobros.id, input.contactoId),
						isNull(contactosCobros.inmovilizacionId),
					),
				)
				.returning({ id: contactosCobros.id });
			if (!enlazado) {
				throw new ORPCError("CONFLICT", {
					message:
						"Esa gestión ya está registrada como la llamada de otra inmovilización.",
				});
			}

			await tx.insert(inmovilizacionesUnidadEventos).values({
				inmovilizacionId: inm.id,
				evento: "registrar_llamada_reactivacion",
				estadoAnterior: "ejecutada",
				estadoNuevo: "ejecutada",
				usuarioId: context.userId,
				detalle: { contactoId: input.contactoId },
			});
		});

		await resolverAvisoLlamarCliente(inm.id);

		return { ok: true };
	});

/**
 * Enlaza la llamada al cliente con un APAGADO ya ejecutado. La gestión
 * (contactosCobros) se crea con el flujo normal de "Registrar Contacto" —la
 * Ficha 360 lo abre sola al ejecutar el apagado— y acá solo se la ata a la
 * inmovilización para cerrar el ciclo del aviso.
 *
 * Ya no hay "Pagó / No pagó" ni reactivación automática: pedir la
 * reactivación exige el respaldo de pago o promesa de `solicitarInmovilizacion`,
 * y el seguimiento posterior (reactivar, recuperar) es manual. Aparte del router por el mismo límite de TS7056 que
 * `registrarLlamadaReactivacion`.
 */
export const registrarLlamadaApagado = cobrosProcedure
	.input(
		z.object({
			inmovilizacionId: z.string().uuid(),
			contactoId: z.string().uuid(),
		}),
	)
	.handler(async ({ input, context }) => {
		const [inm] = await db
			.select()
			.from(inmovilizacionesUnidad)
			.where(
				and(
					eq(inmovilizacionesUnidad.id, input.inmovilizacionId),
					eq(inmovilizacionesUnidad.accion, "apagado"),
					eq(inmovilizacionesUnidad.estado, "ejecutada"),
				),
			)
			.limit(1);

		if (!inm) {
			throw new ORPCError("BAD_REQUEST", {
				message: "No hay un apagado ejecutado con ese id.",
			});
		}

		await assertAccesoLlamadaInmovilizacion(
			inm,
			context.userId,
			context.userRole,
		);

		if (inm.llamadaContactoId !== null) {
			throw new ORPCError("CONFLICT", {
				message: "Esta llamada ya se registró.",
			});
		}

		// Chequeo temprano SIN lock (mensaje claro rápido); el re-chequeo CON
		// lock dentro de la transacción es la garantía real bajo concurrencia
		// — ver comentario de `filaSigueVigente`. Review de Codex, PR #1758.
		if (!(await filaSigueVigente(inm, getHistorialUnidadFisica))) {
			throw new ORPCError("CONFLICT", {
				message:
					"Este apagado ya no es el vigente de la unidad: fue superado por un ciclo más reciente.",
			});
		}

		// Mismo guard que registrarLlamadaReactivacion: MISMO caso, una LLAMADA
		// posterior a la ejecución (no cualquier gestión vieja o de otro
		// canal), y no enlazada ya a otra inmovilización. Review de Codex, PR
		// #1758.
		const [contacto] = await db
			.select({
				id: contactosCobros.id,
				inmovilizacionId: contactosCobros.inmovilizacionId,
			})
			.from(contactosCobros)
			.where(
				and(
					eq(contactosCobros.id, input.contactoId),
					eq(contactosCobros.casoCobroId, inm.casoCobroId),
					eq(contactosCobros.metodoContacto, "llamada"),
					gt(contactosCobros.fechaContacto, inm.ejecutadoAt ?? new Date(0)),
				),
			)
			.limit(1);
		if (!contacto) {
			throw new ORPCError("BAD_REQUEST", {
				message:
					"El contacto indicado no es una llamada registrada después del apagado.",
			});
		}
		if (contacto.inmovilizacionId !== null) {
			throw new ORPCError("CONFLICT", {
				message:
					"Esa gestión ya está registrada como la llamada de otra inmovilización.",
			});
		}

		await db.transaction(async (tx) => {
			// Mismo criterio que registrarLlamadaReactivacion: advisory lock por
			// unidad PRIMERO (serializa contra ejecutarAprobada, evita el
			// deadlock de locks de fila cruzados — review de Codex, PR #1758,
			// ver `bloquearUnidadFisica`), y el SELECT ... FOR UPDATE de esta
			// fila como defensa adicional antes de re-verificar que sigue
			// siendo la vigente.
			await bloquearUnidadFisica(tx, {
				casoCobroId: inm.casoCobroId,
				wialonUnitId: inm.wialonUnitId,
			});
			await tx
				.select({ id: inmovilizacionesUnidad.id })
				.from(inmovilizacionesUnidad)
				.where(eq(inmovilizacionesUnidad.id, inm.id))
				.for("update");
			if (!(await filaSigueVigente(inm, getHistorialUnidadFisicaTx(tx)))) {
				throw new ORPCError("CONFLICT", {
					message:
						"Este apagado ya no es el vigente de la unidad: fue superado por un ciclo más reciente.",
				});
			}

			// Mismo criterio que registrarLlamadaReactivacion: los UPDATE
			// condicionados a IS NULL son la garantía bajo concurrencia.
			const [apagado] = await tx
				.update(inmovilizacionesUnidad)
				.set({ llamadaContactoId: input.contactoId, updatedAt: new Date() })
				.where(
					and(
						eq(inmovilizacionesUnidad.id, inm.id),
						isNull(inmovilizacionesUnidad.llamadaContactoId),
					),
				)
				.returning({ id: inmovilizacionesUnidad.id });
			if (!apagado) {
				throw new ORPCError("CONFLICT", {
					message: "Esta llamada ya se registró.",
				});
			}

			const [enlazado] = await tx
				.update(contactosCobros)
				.set({ inmovilizacionId: inm.id })
				.where(
					and(
						eq(contactosCobros.id, input.contactoId),
						isNull(contactosCobros.inmovilizacionId),
					),
				)
				.returning({ id: contactosCobros.id });
			if (!enlazado) {
				throw new ORPCError("CONFLICT", {
					message:
						"Esa gestión ya está registrada como la llamada de otra inmovilización.",
				});
			}

			await tx.insert(inmovilizacionesUnidadEventos).values({
				inmovilizacionId: inm.id,
				evento: "registrar_llamada_apagado",
				estadoAnterior: "ejecutada",
				estadoNuevo: "ejecutada",
				usuarioId: context.userId,
				detalle: { contactoId: input.contactoId },
			});
		});

		await resolverAvisoLlamarCliente(inm.id);

		return { ok: true };
	});

/**
 * Lo que el modal de "Solicitar reactivación" ofrece como respaldo: los pagos
 * registrados en cartera desde el apagado y la promesa activa del caso. Es solo
 * lectura: al solicitar, el server vuelve a verificarlo (`solicitarInmovilizacion`).
 * Aparte del router por el límite de TS7056.
 */
export const getRespaldoReactivacion = cobrosProcedure
	.input(z.object({ casoCobroId: z.string().uuid() }))
	.handler(
		async ({
			input,
			context,
		}): Promise<{
			apagadoEjecutadoAt: Date | null;
			pagos: PagoRespaldo[];
			promesa: PromesaRespaldo | null;
			/** Por qué no se pudieron leer los pagos (cartera caída o deshabilitada). */
			errorPagos: string | null;
		}> => {
			await assertAccesoCasoCobro(
				input.casoCobroId,
				context.userId,
				context.userRole,
			);
			const caso = await getCasoParaInmovilizacion(input.casoCobroId);
			if (!caso?.numeroCreditoSifco) {
				throw new ORPCError("BAD_REQUEST", {
					message: "El caso no tiene crédito de cartera asociado.",
				});
			}
			const historial = await getHistorialUnidadFisica(
				input.casoCobroId,
				caso.wialonUnitId ?? null,
			);
			const apagado = ultimaEjecutada(historial, "apagado");
			const promesa = await leerPromesaActivaCaso(input.casoCobroId);
			if (!apagado?.ejecutadoAt) {
				return {
					apagadoEjecutadoAt: null,
					pagos: [],
					promesa,
					errorPagos: null,
				};
			}
			let pagos: PagoRespaldo[] = [];
			let errorPagos: string | null = null;
			try {
				pagos = await leerPagosPosterioresAlApagado(
					caso.numeroCreditoSifco,
					apagado.ejecutadoAt,
				);
			} catch (error) {
				if (!(error instanceof ORPCError)) {
					// Un error nuestro (no de cartera) no debe esconderse tras el
					// mensaje genérico: queda en el log del server.
					console.error("[getRespaldoReactivacion] Error inesperado:", error);
				}
				errorPagos =
					error instanceof ORPCError
						? error.message
						: "No se pudieron consultar los pagos en cartera.";
			}
			return {
				apagadoEjecutadoAt: apagado.ejecutadoAt,
				pagos,
				promesa,
				errorPagos,
			};
		},
	);

/** El asesor registra que LEGION reactivó la unidad — ver `ejecutarPorAsesor`. */
export const ejecutarReactivacion = ejecutarPorAsesor("reactivacion");

const usuarioDecisor = alias(user, "usuario_decisor");
const usuarioEjecutor = alias(user, "usuario_ejecutor");

/**
 * Historial COMPLETO de inmovilizaciones — todos los estados, no solo las
 * pendientes de `getColaInmovilizaciones`. Paginado: la tabla crece con cada
 * ciclo apagado→reactivación de cada caso, y sin límite la cola tardaría más
 * cada semana.
 *
 * Aparte de `inmovilizacionUnidadRouter` por el mismo límite de TS7056 que
 * `registrarLlamadaReactivacion` — ver el comentario de ese export.
 */
export const getHistorialInmovilizaciones = cobrosSupervisorProcedure
	.input(
		z.object({
			page: z.number().int().min(1).default(1),
			perPage: z.number().int().min(1).max(100).default(25),
		}),
	)
	.handler(async ({ input }) => {
		const offset = (input.page - 1) * input.perPage;

		const [filas, [{ total }]] = await Promise.all([
			db
				.select({
					id: inmovilizacionesUnidad.id,
					casoCobroId: inmovilizacionesUnidad.casoCobroId,
					numeroCreditoSifco: inmovilizacionesUnidad.numeroCreditoSifco,
					accion: inmovilizacionesUnidad.accion,
					estado: inmovilizacionesUnidad.estado,
					motivo: inmovilizacionesUnidad.motivo,
					motivoRechazo: inmovilizacionesUnidad.motivoRechazo,
					bucketSnapshot: inmovilizacionesUnidad.bucketSnapshot,
					solicitadoAt: inmovilizacionesUnidad.solicitadoAt,
					solicitanteNombre: user.name,
					decididoAt: inmovilizacionesUnidad.decididoAt,
					decididoPorNombre: usuarioDecisor.name,
					ejecutadoAt: inmovilizacionesUnidad.ejecutadoAt,
					ejecutadoPorNombre: usuarioEjecutor.name,
					modoEjecucion: inmovilizacionesUnidad.modoEjecucion,
					referenciaEjecucion: inmovilizacionesUnidad.referenciaEjecucion,
					resultado: inmovilizacionesUnidad.resultado,
					ubicacionSolicitud: inmovilizacionesUnidad.ubicacionSolicitud,
					ubicacionEjecucion: inmovilizacionesUnidad.ubicacionEjecucion,
					evidenciaR2Key: inmovilizacionesUnidad.evidenciaR2Key,
					evidenciaNombreArchivo: inmovilizacionesUnidad.evidenciaNombreArchivo,
					evidenciaNota: inmovilizacionesUnidad.evidenciaNota,
					clienteNombre: clients.contactPerson,
				})
				.from(inmovilizacionesUnidad)
				.innerJoin(user, eq(inmovilizacionesUnidad.solicitadoPor, user.id))
				.leftJoin(
					usuarioDecisor,
					eq(inmovilizacionesUnidad.decididoPor, usuarioDecisor.id),
				)
				.leftJoin(
					usuarioEjecutor,
					eq(inmovilizacionesUnidad.ejecutadoPor, usuarioEjecutor.id),
				)
				.leftJoin(
					casosCobros,
					eq(inmovilizacionesUnidad.casoCobroId, casosCobros.id),
				)
				.leftJoin(
					contratosFinanciamiento,
					eq(casosCobros.contratoId, contratosFinanciamiento.id),
				)
				.leftJoin(clients, eq(contratosFinanciamiento.clientId, clients.id))
				.orderBy(desc(inmovilizacionesUnidad.solicitadoAt))
				.limit(input.perPage)
				.offset(offset),
			db
				.select({ total: sql<number>`count(*)::int` })
				.from(inmovilizacionesUnidad),
		]);

		// La llave de R2 no sale del server: el supervisor recibe la URL firmada
		// (el bucket es privado) o null si no se pudo firmar.
		const items = await Promise.all(
			filas.map(async ({ evidenciaR2Key, ...fila }) => ({
				...fila,
				evidenciaUrl: evidenciaR2Key
					? await getFileUrl(evidenciaR2Key).catch(() => null)
					: null,
			})),
		);

		return {
			items,
			page: input.page,
			perPage: input.perPage,
			total,
			totalPages: Math.max(1, Math.ceil(total / input.perPage)),
		};
	});
