/**
 * CB-041 — Solicitar/aprobar/ejecutar el apagado o la reactivación de una
 * unidad, con llamada posterior al cliente registrada en la misma Ficha 360.
 *
 * Módulo aparte, no en cobros.ts: mismo motivo que convenio-decision.ts /
 * recuperacion-vehiculo.ts — cobrosAppRouter ya está en el límite donde
 * TS7056 trunca el tipo inferido en el web (ver el comentario de esos
 * archivos y https://orpc.dev/docs/advanced/exceeds-the-maximum-length-problem).
 *
 * Modo de ejecución: MANUAL. La integración con LEGION (`unit/exec_cmd`,
 * CB-120) está bloqueada hasta confirmar permisos/comandos/relé de su lado
 * — ver services/inmovilizacion/ejecutor.ts. `marcarEjecutada` deja
 * constancia de que el supervisor coordinó el apagado/reactivación con
 * LEGION por fuera del CRM.
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
import {
	inmovilizacionesUnidad,
	inmovilizacionesUnidadEventos,
} from "../db/schema/inmovilizacion-unidad";
import { vehicles } from "../db/schema/vehicles";
import { assertCreditoAsignadoEnCarteraPorSifco } from "../lib/credito-cartera-ownership";
import {
	BUCKETS_INMOVILIZACION,
	estadoUnidad,
	type InmovilizacionHistorialItem,
	puedeSolicitar,
} from "../lib/inmovilizacion-unidad";
import { cobrosProcedure, cobrosSupervisorProcedure } from "../lib/orpc";
import { PERMISSIONS } from "../lib/roles";
import { carteraBackClient } from "../services/cartera-back-client";
import { isCarteraBackEnabled } from "../services/cartera-back-integration";
import { ejecutarInmovilizacion } from "../services/inmovilizacion/ejecutor";
import {
	notificarInmovilizacionPendiente,
	notificarInmovilizacionResuelta,
	notificarLlamarCliente,
	notificarUnidadReactivada,
	reasignarAvisosLlamarCliente,
	resolverAvisoLlamarCliente,
	resolverPendientesInmovilizacion,
} from "../services/inmovilizacion-notif";
import {
	assertAccesoCasoCobro,
	marcarInmovilizacionEnviadaARecuperacion,
} from "./cobros";

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
			responsableCobros: casosCobros.responsableCobros,
			numeroCreditoSifco: casosCobros.numeroCreditoSifco,
			vehicleId: vehicles.id,
			wialonUnitId: vehicles.wialonUnitId,
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
 * Necesario porque `marcarEjecutada` y `registrarResultadoLlamada` /
 * `registrarLlamadaReactivacion` toman locks de FILA en orden potencialmente
 * inverso: `marcarEjecutada` de una reactivación lockea primero la
 * reactivación (su propio UPDATE) y DESPUÉS el apagado origen
 * (inmovilizacionOrigenId); `registrarResultadoLlamada` sobre ese mismo
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
 * Se usa en `registrarResultadoLlamada` y `registrarLlamadaReactivacion`,
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
 * inmovilización ejecutada (`registrarResultadoLlamada` o
 * `registrarLlamadaReactivacion`).
 *
 * El caso normal exige ser el asesor asignado al caso (`responsableCobros`), o
 * tener un rol con visibilidad completa (supervisores/admin). Sin embargo, si el
 * caso quedó sin responsable asignado (`responsableCobros == null`),
 * `marcarEjecutada` enrutó el aviso de llamada a `inm.solicitadoPor` como
 * fallback: autorizar a ese usuario para registrar la llamada evita que la
 * tarea quede permanentemente trabada. Review de Codex.
 */
async function assertAccesoLlamadaInmovilizacion(
	inm: { casoCobroId: string; solicitadoPor: string | null },
	userId: string,
	userRole: string,
): Promise<void> {
	if (PERMISSIONS.canViewAllCasosCobros(userRole)) return;

	const [caso] = await db
		.select({
			id: casosCobros.id,
			responsableCobros: casosCobros.responsableCobros,
		})
		.from(casosCobros)
		.where(eq(casosCobros.id, inm.casoCobroId))
		.limit(1);

	if (!caso) {
		throw new ORPCError("NOT_FOUND", {
			message: "Caso de cobro no encontrado o sin acceso.",
		});
	}

	// 1. Asesor asignado al caso
	if (caso.responsableCobros && caso.responsableCobros === userId) {
		return;
	}

	// 2. Fallback: caso sin asesor asignado y el usuario es quien solicitó la acción
	if (
		!caso.responsableCobros &&
		inm.solicitadoPor &&
		inm.solicitadoPor === userId
	) {
		return;
	}

	throw new ORPCError("NOT_FOUND", {
		message: "Caso de cobro no encontrado o sin acceso.",
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
				solicitudAbierta: FilaInmovilizacion | null;
				pendienteLlamar: FilaInmovilizacion | null;
				pendienteLlamarReactivacion: FilaInmovilizacion | null;
				historial: FilaInmovilizacion[];
				tieneGps: boolean;
			}> => {
				await assertAccesoCasoCobro(
					input.casoCobroId,
					context.userId,
					context.userRole,
				);

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

				const solicitudAbierta =
					historial.find(
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
					historial,
					tieneGps: caso?.wialonUnitId != null,
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
				motivo: z
					.string()
					.trim()
					.min(5, "El motivo es obligatorio (mínimo 5 caracteres)"),
			}),
		)
		.handler(async ({ input, context }) => {
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
					message:
						"El vehículo asociado no tiene una unidad GPS vinculada.",
				});
			}
			const wialonUnitId = caso.wialonUnitId;

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
					message = `El apagado aplica a créditos en B2/B3 y este está en B${bucket}.`;
				}
				throw new ORPCError("BAD_REQUEST", { message });
			}

			// La reactivación pedida directo (sin pasar por "pagó" en la llamada)
			// también apunta al apagado que revierte, para que al ejecutarse ese
			// apagado quede con resultado = 'reactivada'.
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
					// acción opuesta (marcarEjecutada). Re-leer el historial bajo
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
							message = `El apagado aplica a créditos en B2/B3 y este está en B${bucket}.`;
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
							motivo: input.motivo,
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
						detalle: { accion: input.accion, motivo: input.motivo },
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
				motivo: input.motivo,
				solicitadoPorUserId: context.userId,
				solicitadoPorRole: context.userRole,
			});

			return { id: inmovilizacionId };
		}),

	/**
	 * El propio solicitante cancela su solicitud, solo mientras siga
	 * `pendiente_aprobacion`. Una vez aprobada ya no se cancela desde acá: el
	 * supervisor ya la está coordinando con LEGION.
	 */
	cancelarSolicitud: cobrosProcedure
		.input(z.object({ id: z.string().uuid() }))
		.handler(async ({ input, context }) => {
			const cancelada = await db.transaction(async (tx) => {
				const [fila] = await tx
					.update(inmovilizacionesUnidad)
					.set({ estado: "cancelada", updatedAt: new Date() })
					.where(
						and(
							eq(inmovilizacionesUnidad.id, input.id),
							eq(inmovilizacionesUnidad.solicitadoPor, context.userId),
							eq(inmovilizacionesUnidad.estado, "pendiente_aprobacion"),
						),
					)
					.returning({ id: inmovilizacionesUnidad.id });
				if (!fila) return false;

				await tx.insert(inmovilizacionesUnidadEventos).values({
					inmovilizacionId: input.id,
					evento: "cancelar",
					estadoAnterior: "pendiente_aprobacion",
					estadoNuevo: "cancelada",
					usuarioId: context.userId,
				});
				return true;
			});

			if (!cancelada) {
				throw new ORPCError("CONFLICT", {
					message:
						"La solicitud ya no está pendiente de aprobación, o no te pertenece.",
				});
			}

			// Los supervisores ya no tienen nada que decidir: sin esto seguían
			// viendo el aviso y al abrirlo chocaban con un CONFLICT.
			await resolverPendientesInmovilizacion(input.id);

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
				accion: actualizada.accion,
				decision: nuevoEstado,
				motivoRechazo: input.motivoRechazo,
				solicitanteUserId: actualizada.solicitadoPor,
				decididoPorUserId: context.userId,
				decididoPorRole: context.userRole,
			});

			return { ok: true };
		}),

	/**
	 * El supervisor marca que la acción YA se ejecutó — hoy siempre en modo
	 * manual: coordinó con LEGION por fuera del CRM. `referencia` es la nota
	 * o ticket de LEGION que respalda eso.
	 */
	marcarEjecutada: cobrosSupervisorProcedure
		.input(
			z.object({
				id: z.string().uuid(),
				referencia: z.string().trim().max(500).optional(),
			}),
		)
		.handler(async ({ input, context }) => {
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
			let detalleFalloPrecondicion: Record<string, unknown> | undefined;

			// Si la acción es apagado, revalidar que el crédito siga en mora B2/B3:
			// si el cliente pagó entre la aprobación y la ejecución, el crédito bajó
			// a B0/B1 (o salió del funnel) y no debe apagarse el vehículo. Review de Codex.
			if (inm.accion === "apagado" && isCarteraBackEnabled()) {
				let bucket: number | null = null;
				try {
					const bucketActual = await carteraBackClient.getBucketActualCredito(
						inm.numeroCreditoSifco,
					);
					bucket = bucketActual?.bucket ?? null;
				} catch (error) {
					console.error(
						"[marcarEjecutada] No se pudo resolver el bucket:",
						error,
					);
				}
				if (bucket == null) {
					// Fallo transitorio de red/timeout con cartera-back: se rechaza la
					// ejecución pero no se cancela la aprobación para permitir reintentar.
					throw new ORPCError("CONFLICT", {
						message:
							"No se pudo confirmar el bucket del crédito en cartera. Intentá de nuevo en unos minutos.",
					});
				}
				if (!BUCKETS_INMOVILIZACION.includes(bucket)) {
					motivoFalloPrecondicion = `El crédito ya no se encuentra en mora B2/B3 (está en B${bucket}). El apagado ya no aplica.`;
					detalleFalloPrecondicion = { bucket };
				}
			}

			let resultado!: Awaited<ReturnType<typeof ejecutarInmovilizacion>>;

			await db.transaction(async (tx) => {
				// Serializa contra registrarResultadoLlamada / registrarLlamadaReactivacion
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
						} else if (
							vehiculoTx.wialonUnitId !== inm.wialonUnitId
						) {
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
							detalle: {
								motivo: motivoFalloPrecondicion,
								...detalleFalloPrecondicion,
							},
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
						referenciaEjecucion: input.referencia ?? null,
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
					detalle: { modo: resultado.modo, referencia: input.referencia },
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
				throw new ORPCError("CONFLICT", {
					message: motivoFalloPrecondicion,
				});
			}

			// Reactivación directa (cliente pagó por ventanilla, sin pasar por
			// registrarResultadoLlamada): el aviso "llamar al cliente" del
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
			// Fallback a quien solicitó: sin esto, un caso momentáneamente sin
			// responsableCobros (columna nullable) se quedaba sin avisar a
			// NADIE — ni al asesor, ni a quien pidió la acción. Review de Codex.
			const asesorUserId = caso?.responsableCobros ?? inm.solicitadoPor;
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
						// 2. Si el caso fue reasignado concurrentemente entre la lectura temprana
						// y el envío del aviso, el aviso recién creado quedó asignado al asesor
						// anterior. Re-leer el caso actual y reasignar al responsable vigente.
						// Review de Codex, PR #1758.
						const casoPostEnvio = await getCasoParaInmovilizacion(
							inm.casoCobroId,
						);
						const responsableActual =
							casoPostEnvio?.responsableCobros ?? inm.solicitadoPor;
						if (responsableActual && responsableActual !== asesorUserId) {
							await reasignarAvisosLlamarCliente({
								casoCobroId: inm.casoCobroId,
								nuevoResponsableUserId: responsableActual,
								soloSiResponsableEs: casoPostEnvio?.responsableCobros ?? null,
							});
						}
					}
				}
			}

			return { ok: true, modo: resultado.modo };
		}),

	/**
	 * Registra el resultado de la llamada posterior al apagado. La gestión en
	 * sí (contactosCobros) ya se creó por `createContactoCobros` — acá solo
	 * se ENLAZA esa gestión con la inmovilización y se decide el siguiente
	 * paso: `paga` abre una solicitud de reactivación (a aprobación); `no_paga`
	 * cierra el ciclo dejando que la UI ofrezca `enviarCreditoARecuperacion`
	 * (ya existe, no se duplica acá).
	 */
	registrarResultadoLlamada: cobrosProcedure
		.input(
			z.object({
				inmovilizacionId: z.string().uuid(),
				contactoId: z.string().uuid(),
				resultado: z.enum(["paga", "no_paga"]),
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
					message: "El resultado de esta llamada ya se registró.",
				});
			}

			// Chequeo temprano SIN lock: da un mensaje claro rápido para el caso
			// común. La garantía real bajo concurrencia es el re-chequeo CON
			// lock, dentro de la transacción (ver más abajo) — este de acá
			// puede quedar desactualizado si algo cambia entre esta lectura y
			// el UPDATE. Review de Codex, PR #1758.
			if (!(await filaSigueVigente(inm, getHistorialUnidadFisica))) {
				throw new ORPCError("CONFLICT", {
					message:
						"Este apagado ya no es el vigente de la unidad: fue superado por un ciclo más reciente.",
				});
			}

			// El contacto tiene que ser del MISMO caso — evita enlazar la
			// llamada de un caso distinto (contactoId enumerable) —, una LLAMADA
			// (no whatsapp/sms/visita/pago) POSTERIOR al apagado, y no puede
			// estar ya enlazado a otra inmovilización. Sin el filtro de método y
			// fecha, cualquier gestión vieja o de otro canal —incluso una de
			// `resultado: "paga"`— podía enlazarse como si fuera la llamada
			// posterior exigida, sin que esa llamada hubiera ocurrido. Review de
			// Codex, PR #1758.
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

			if (input.resultado === "paga") {
				await assertCreditoAsignadoEnCarteraPorSifco({
					numeroSifco: inm.numeroCreditoSifco,
					emailUsuario: context.session.user.email,
					userRole: context.userRole,
					accion: "solicitar la reactivación de la unidad",
				});
			}

			let reactivacionId: string | null = null;

			try {
				await db.transaction(async (tx) => {
					// El advisory lock (por unidad, adquirido PRIMERO) serializa esta
					// transacción contra marcarEjecutada — sin él, las dos podían
					// tomar locks de fila en orden cruzado (deadlock 40P01, review de
					// Codex, PR #1758: ver comentario de `bloquearUnidadFisica`). El
					// SELECT ... FOR UPDATE de esta fila que sigue abajo ya no es la
					// única defensa, pero queda como cinturón y tirantes: si
					// `inm` sigue con `resultado` desactualizado (marcarEjecutada
					// tenía que marcarla `resultado = 'reactivada'` porque es el
					// origen de una reactivación que se está ejecutando AHORA), esta
					// espera a que esa transacción termine y re-verifica con el
					// estado YA actualizado.
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

					// Los chequeos de arriba son para dar un mensaje claro; la garantía
					// bajo concurrencia (doble clic, dos asesores a la vez) son estos
					// UPDATE condicionados a `IS NULL`: si otro ya enlazó, no devuelven
					// fila y la transacción entera se revierte.
					const [apagado] = await tx
						.update(inmovilizacionesUnidad)
						.set({
							llamadaContactoId: input.contactoId,
							// "no_pago_pendiente_recuperacion": este endpoint solo conoce la
							// respuesta de la llamada; al ejecutarse enviarCreditoARecuperacion
							// (vía cobros.ts), esa transición actualiza el resultado a
							// "enviada_recuperacion".
							resultado:
								input.resultado === "paga"
									? null
									: "no_pago_pendiente_recuperacion",
							updatedAt: new Date(),
						})
						.where(
							and(
								eq(inmovilizacionesUnidad.id, inm.id),
								isNull(inmovilizacionesUnidad.llamadaContactoId),
							),
						)
						.returning({ id: inmovilizacionesUnidad.id });
					if (!apagado) {
						throw new ORPCError("CONFLICT", {
							message: "El resultado de esta llamada ya se registró.",
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

					if (input.resultado === "paga") {
						if (inm.wialonUnitId == null) {
							throw new ORPCError("CONFLICT", {
								message:
									"El vehículo asociado no tiene una unidad GPS vinculada.",
							});
						}
						const [reactivacion] = await tx
							.insert(inmovilizacionesUnidad)
							.values({
								casoCobroId: inm.casoCobroId,
								numeroCreditoSifco: inm.numeroCreditoSifco,
								vehicleId: inm.vehicleId,
								wialonUnitId: inm.wialonUnitId,
								accion: "reactivacion",
								motivo: "Cliente pagó tras la llamada posterior al apagado.",
								bucketSnapshot: inm.bucketSnapshot,
								solicitadoPor: context.userId,
								inmovilizacionOrigenId: inm.id,
							})
							.returning({ id: inmovilizacionesUnidad.id });
						reactivacionId = reactivacion.id;

						await tx.insert(inmovilizacionesUnidadEventos).values({
							inmovilizacionId: reactivacion.id,
							evento: "solicitar",
							estadoNuevo: "pendiente_aprobacion",
							usuarioId: context.userId,
							detalle: { accion: "reactivacion", origenId: inm.id },
						});
					}

					await tx.insert(inmovilizacionesUnidadEventos).values({
						inmovilizacionId: inm.id,
						evento: "registrar_resultado_llamada",
						estadoAnterior: "ejecutada",
						estadoNuevo: "ejecutada",
						usuarioId: context.userId,
						detalle: {
							resultado: input.resultado,
							contactoId: input.contactoId,
						},
					});
				});
			} catch (error) {
				// "paga" choca con el índice único si ya hay una solicitud abierta
				// en el caso (p. ej. alguien pidió la reactivación directo).
				if (esViolacionUnica(error)) {
					throw new ORPCError("CONFLICT", {
						message:
							"Ya hay una solicitud de inmovilización abierta para este caso. Resolvé esa primero.",
					});
				}
				throw error;
			}

			await resolverAvisoLlamarCliente(inm.id);

			if (input.resultado === "paga" && reactivacionId) {
				const casoActualizado = await getCasoParaInmovilizacion(
					inm.casoCobroId,
				);
				await notificarInmovilizacionPendiente({
					inmovilizacionId: reactivacionId,
					casoCobroId: inm.casoCobroId,
					accion: "reactivacion",
					clienteNombre: casoActualizado?.clienteNombre ?? undefined,
					numeroCreditoSifco: inm.numeroCreditoSifco,
					motivo: "Cliente pagó tras la llamada posterior al apagado.",
					solicitadoPorUserId: context.userId,
					solicitadoPorRole: context.userRole,
				});
			}

			return { ok: true };
		}),
};

/**
 * Confirma que el asesor ya llamó al cliente tras una REACTIVACIÓN
 * ejecutada. Simétrico a `registrarResultadoLlamada` pero sin su
 * bifurcación paga/no_paga — acá no hay siguiente paso que decidir, solo
 * cerrar el ciclo dejando constancia de la gestión.
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

		// Mismo guard que registrarResultadoLlamada: MISMO caso, una LLAMADA
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
			// Mismo criterio que registrarResultadoLlamada: advisory lock por
			// unidad PRIMERO (serializa contra marcarEjecutada, evita el
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

			// Mismo criterio que registrarResultadoLlamada: los UPDATE
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

		return {
			items: filas,
			page: input.page,
			perPage: input.perPage,
			total,
			totalPages: Math.max(1, Math.ceil(total / input.perPage)),
		};
	});
