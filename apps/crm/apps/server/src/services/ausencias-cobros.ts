/**
 * Ausencia indefinida de un asesor (tarea M5 de
 * docs/features/cobros-02/18-equipo-solicitudes-backend.md).
 *
 * Marcar ausente: se reparte su cartera al equipo con un traslado
 * `redistribucion` de cartera (según la capacidad de cada asesor) y se lo saca
 * del pool para que el motor no le mande cuentas nuevas. Reactivar: se lo
 * vuelve a meter al pool, se le devuelve lo que sigue con quien lo recibió y se
 * avisa al equipo. La cobertura con suplente fijo y fechas cerradas
 * (`crearCobertura`) no cambia.
 */

import { ORPCError } from "@orpc/server";
import { and, desc, eq, gte, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import {
	ausenciasAsesorCobros,
	coberturasAgendaCobros,
} from "../db/schema/cobros";
import { notifications } from "../db/schema/notifications";
import {
	type MotivoAusencia,
	motivoDeLaDevolucion,
	motivoDelReparto,
	textoAvisoReactivacion,
} from "../lib/ausencia-asesor";
import { toDateStrGT } from "../lib/guatemala-month-window";
import { CarteraBackHttpError, carteraBackClient } from "./cartera-back-client";
import {
	construirMapaAsesorUsuario,
	obtenerSupervisoresCobros,
} from "./cobros-notif-helpers";
import { reconciliarAvisosLlamarCliente } from "./inmovilizacion-notif";

type RolNotificacion = (typeof notifications.createdByRole.enumValues)[number];

export interface Actor {
	userId: string;
	role: RolNotificacion;
	email: string;
}

/** cartera-back responde 400/409 de negocio con un mensaje que el supervisor puede leer. */
function traducirErrorCartera(error: unknown): never {
	if (
		error instanceof CarteraBackHttpError &&
		(error.status === 400 || error.status === 409 || error.status === 404)
	) {
		throw new ORPCError(
			error.status === 400
				? "BAD_REQUEST"
				: error.status === 404
					? "NOT_FOUND"
					: "CONFLICT",
			{ message: error.payload?.message ?? error.message },
		);
	}
	throw error;
}

/** El asesor de cartera, con su usuario del CRM (match por `email_cash_in`). */
async function asesorConUsuario(asesorId: number) {
	const [pool, usuarios] = await Promise.all([
		carteraBackClient.getPoolPorAsesor({ useCache: false }),
		db.select({ id: user.id, name: user.name, email: user.email }).from(user),
	]);
	const asesor = pool.find((a) => a.asesor_id === asesorId);
	if (!asesor) {
		throw new ORPCError("NOT_FOUND", {
			message: "El asesor no está en el pool de cobros.",
		});
	}
	const correo = asesor.email_cash_in?.trim().toLowerCase();
	const crm = usuarios.find((u) => u.email.trim().toLowerCase() === correo);
	return {
		asesor,
		userId: crm?.id ?? null,
		nombre: crm?.name ?? asesor.nombre,
	};
}

/**
 * Una ausencia es temporal: a un asesor ya desactivado no se le marca ausente (su
 * cartera se reparte con un traslado normal). Además la reactivación le devuelve la
 * cartera solo si está activo, así que la ausencia quedaría sin poder cerrarse.
 */
function exigirAsesorActivo(asesor: { activo: boolean | null }) {
	if (asesor.activo === false) {
		throw new ORPCError("CONFLICT", {
			message:
				"El asesor está desactivado: no se puede marcar ausente. Para repartir su cartera use un traslado.",
		});
	}
}

async function ausenciaVigente(
	asesorId: number,
	ejecutor: Pick<typeof db, "select"> = db,
) {
	const [fila] = await ejecutor
		.select()
		.from(ausenciasAsesorCobros)
		.where(
			and(
				eq(ausenciasAsesorCobros.asesorId, asesorId),
				eq(ausenciasAsesorCobros.estado, "vigente"),
			),
		)
		.limit(1);
	return fila ?? null;
}

/**
 * Una ausencia que quedó sin `operacionTrasladoId` (la confirmación se cortó sin
 * respuesta) se concilia con cartera por su clave de idempotencia: si el traslado
 * sí se confirmó, se completa el registro; si no, devuelve `null`.
 */
async function reconciliarPendiente(id: string) {
	const op = await carteraBackClient.buscarTrasladoPorClave(id);
	if (!op) return null;
	const [fila] = await db
		.update(ausenciasAsesorCobros)
		.set({
			operacionTrasladoId: op.operacionId,
			cuentasRepartidas: op.cuentas,
			bucketsPausados: op.bucketsPausados ?? [],
			poolPausado: true,
		})
		.where(eq(ausenciasAsesorCobros.id, id))
		.returning();
	return fila ?? null;
}

/** Lo que dura una previsualización de cartera (10 min) más un margen. */
const PENDIENTE_VENCE_MS = 15 * 60_000;

/**
 * Ausencias que nunca llegaron a registrar su traslado y ya pasaron la vida de
 * cualquier previsualización: no pueden confirmarse nunca más. Se concilian con
 * cartera (por si el traslado sí se confirmó) y, si no, se descartan para que el
 * asesor pueda previsualizarse y marcarse de nuevo.
 */
async function descartarPendientesVencidas(asesorId: number) {
	const corte = new Date(Date.now() - PENDIENTE_VENCE_MS);
	const vencidas = await db
		.select({ id: ausenciasAsesorCobros.id })
		.from(ausenciasAsesorCobros)
		.where(
			and(
				eq(ausenciasAsesorCobros.asesorId, asesorId),
				eq(ausenciasAsesorCobros.estado, "vigente"),
				isNull(ausenciasAsesorCobros.operacionTrasladoId),
				lt(ausenciasAsesorCobros.inicioAt, corte),
			),
		);
	for (const { id } of vencidas) {
		try {
			if (await reconciliarPendiente(id)) continue;
		} catch (error) {
			// Sin poder preguntar a cartera no se descarta nada.
			console.warn("[ausencias] No se pudo conciliar la pendiente:", id, error);
			continue;
		}
		// Solo la versión vencida que se inspeccionó: si otra llamada la descartó y
		// volvió a crear el registro con el mismo id, el nuevo no cumple `lt` y se queda.
		await db
			.delete(ausenciasAsesorCobros)
			.where(
				and(
					eq(ausenciasAsesorCobros.id, id),
					isNull(ausenciasAsesorCobros.operacionTrasladoId),
					lt(ausenciasAsesorCobros.inicioAt, corte),
				),
			);
	}
}

/** No se marca ausente a quien ya lo está ni a quien tiene una cobertura abierta. */
async function validarQueSePuedeMarcar(
	asesorId: number,
	titularUserId: string | null,
	ejecutor: Pick<typeof db, "select"> = db,
) {
	if (await ausenciaVigente(asesorId, ejecutor)) {
		throw new ORPCError("CONFLICT", {
			message: "Este asesor ya está marcado como ausente.",
		});
	}
	if (!titularUserId) return;
	const hoy = toDateStrGT(new Date());
	const [cobertura] = await ejecutor
		.select({ id: coberturasAgendaCobros.id })
		.from(coberturasAgendaCobros)
		.where(
			and(
				// Como titular o como suplente: sacarlo del pool deja sin cubrir al titular.
				or(
					eq(coberturasAgendaCobros.titularId, titularUserId),
					eq(coberturasAgendaCobros.suplenteId, titularUserId),
				),
				isNull(coberturasAgendaCobros.canceladaEn),
				gte(coberturasAgendaCobros.hasta, hoy),
			),
		)
		.limit(1);
	if (cobertura) {
		throw new ORPCError("CONFLICT", {
			message:
				"Este asesor ya tiene una cobertura vigente. Cancélela antes de marcarlo ausente.",
		});
	}
}

/** Muestra cómo quedaría el reparto (Figma «Redistribución») sin tocar nada. */
export async function previsualizarRepartoAusencia(params: {
	asesorId: number;
	motivo: MotivoAusencia;
	actorEmail: string;
}) {
	const { asesor, userId } = await asesorConUsuario(params.asesorId);
	exigirAsesorActivo(asesor);
	await descartarPendientesVencidas(params.asesorId);
	await validarQueSePuedeMarcar(params.asesorId, userId);
	try {
		return await carteraBackClient.previsualizarTrasladoCartera({
			asesorOrigenId: params.asesorId,
			modo: "redistribucion",
			motivo: motivoDelReparto(params.motivo),
			ponderarPorCapacidad: true,
			// Una ausencia es temporal: las cuentas fuera del funnel (canceladas,
			// caídas…) no se gestionan y se quedan con el asesor, no se reparten.
			mantenerEspeciales: true,
			// El pool se pausa dentro de la confirmación del traslado: sin ventana
			// en la que el motor le asigne cuentas que el reparto no incluyó.
			pausarPoolOrigen: true,
			actorEmail: params.actorEmail,
		});
	} catch (error) {
		traducirErrorCartera(error);
	}
}

type DatosSolicitudAusencia = {
	asesorId: number;
	motivo: MotivoAusencia;
	nota?: string;
	actor: Actor;
};

/** ¿La fila guardada es la MISMA solicitud (mismo asesor, motivo, nota y usuario)? */
function esLaMismaSolicitud(
	fila: {
		asesorId: number;
		motivo: string;
		nota: string | null;
		creadaPor: string | null;
	},
	params: DatosSolicitudAusencia,
) {
	return (
		fila.asesorId === params.asesorId &&
		fila.motivo === params.motivo &&
		(fila.nota ?? null) === (params.nota || null) &&
		fila.creadaPor === params.actor.userId
	);
}

export async function marcarAusenteIndefinido(params: {
	id: string;
	asesorId: number;
	motivo: MotivoAusencia;
	nota?: string;
	previewId: string;
	actor: Actor;
}) {
	const existente = await db
		.select()
		.from(ausenciasAsesorCobros)
		.where(eq(ausenciasAsesorCobros.id, params.id))
		.limit(1)
		.then((r) => r[0]);
	// Un reintento solo puede repetir la solicitud original: ni otro asesor, ni otro
	// motivo, ni otro usuario con el mismo id.
	if (existente && !esLaMismaSolicitud(existente, params)) {
		throw new ORPCError("CONFLICT", {
			message: "La solicitud ya se usó con otros datos.",
		});
	}
	// Reintento del mismo clic: si ya se repartió, se devuelve lo hecho.
	if (existente?.operacionTrasladoId) return existente;

	// Pendientes vencidas (de esta u otra solicitud) se concilian o se descartan.
	await descartarPendientesVencidas(params.asesorId);
	const vigente = existente
		? await db
				.select()
				.from(ausenciasAsesorCobros)
				.where(eq(ausenciasAsesorCobros.id, params.id))
				.limit(1)
				.then((r) => r[0])
		: undefined;
	// Se descartó o se conciliaron mientras tanto.
	if (existente && vigente?.operacionTrasladoId) return vigente;
	let reintento = vigente;

	const { asesor, userId: titularId } = await asesorConUsuario(params.asesorId);
	// Solo al crear: un reintento de un registro pendiente (cuyo traslado quizá ya se
	// confirmó) debe poder conciliarse aunque el asesor se haya desactivado después.
	if (!reintento) exigirAsesorActivo(asesor);
	if (!reintento) {
		// Serializa con `crearCobertura` (mismo lock por participante): la
		// comprobación de coberturas y el alta de la ausencia son una sola unidad.
		try {
			await db.transaction(async (tx) => {
				if (titularId) {
					await tx.execute(
						sql`SELECT pg_advisory_xact_lock(114, hashtext(${titularId}))`,
					);
				}
				await validarQueSePuedeMarcar(params.asesorId, titularId, tx);
				await tx.insert(ausenciasAsesorCobros).values({
					id: params.id,
					asesorId: params.asesorId,
					titularId,
					motivo: params.motivo,
					nota: params.nota || null,
					creadaPor: params.actor.userId,
				});
			});
		} catch (error) {
			// Si otra llamada idéntica (doble envío, reintento del cliente) creó ESTA misma
			// solicitud mientras tanto, esto no es «ya está ausente» sino el reintento
			// anunciado: se sigue por la ruta de conciliación con la fila de la ganadora.
			const ganadora = await db
				.select()
				.from(ausenciasAsesorCobros)
				.where(eq(ausenciasAsesorCobros.id, params.id))
				.limit(1)
				.then((r) => r[0]);
			if (ganadora) {
				if (!esLaMismaSolicitud(ganadora, params)) {
					throw new ORPCError("CONFLICT", {
						message: "La solicitud ya se usó con otros datos.",
					});
				}
				if (ganadora.operacionTrasladoId) return ganadora;
				reintento = ganadora;
			} else {
				if (error instanceof ORPCError) throw error;
				// Solo la violación del índice único (23505: otra ausencia vigente ganó la
				// carrera) es «ya está ausente». Cualquier otro fallo (conexión, tiempo,
				// interbloqueo, migración faltante) se relanza: la transacción se revirtió y
				// decir que ya está ausente sería falso y no dejaría reintentar.
				const e = error as { code?: string; cause?: { code?: string } };
				if ((e?.code ?? e?.cause?.code) !== "23505") throw error;
				throw new ORPCError("CONFLICT", {
					message: "Este asesor ya está marcado como ausente.",
				});
			}
		}
	}

	// Reintento de un registro pendiente: antes de confirmar de nuevo se pregunta si
	// el traslado ya se había confirmado (aunque la previsualización sea otra).
	if (reintento) {
		const conciliada = await reconciliarPendiente(params.id);
		if (conciliada) {
			await reconciliarAvisosLlamarCliente().catch((error) =>
				console.warn(
					"[ausencias] No se reconciliaron los avisos de llamadas:",
					error,
				),
			);
			return conciliada;
		}
	}

	let operacionId: string;
	let cuentas: number;
	let buckets: number[];
	try {
		const res = await carteraBackClient.confirmarTrasladoCartera({
			previewId: params.previewId,
			idempotencyKey: params.id,
			actorEmail: params.actor.email,
			// La previsualización debe ser de este asesor y con la pausa del pool.
			asesorOrigenId: params.asesorId,
			pausarPoolOrigen: true,
		});
		operacionId = res.operacionId;
		cuentas = res.cuentas;
		buckets = res.bucketsPausados ?? [];
	} catch (error) {
		// Ante un rechazo de cartera (400/404/409) primero se pregunta por la clave: otra
		// llamada con ESTE mismo id (doble envío, otra previsualización) pudo confirmar
		// el traslado mientras esta recibía su rechazo, p. ej. «la cartera cambió» porque
		// la ganadora ya repartió. Si es así la ausencia existe y se devuelve, también
		// al reintento, en vez de mostrar un error por algo que sí se hizo.
		const rechazada =
			error instanceof CarteraBackHttpError &&
			(error.status === 400 || error.status === 404 || error.status === 409);
		if (rechazada) {
			const confirmada = await reconciliarPendiente(params.id).catch(
				() => null,
			);
			if (confirmada) return confirmada;
		}
		// Solo se quita la ausencia que ESTA llamada creó y que cartera-back RECHAZÓ el
		// traslado: ahí no se repartió nada ni se pausó el pool. Ante un timeout, corte
		// de conexión o 5xx el traslado pudo confirmarse sin que llegara la respuesta:
		// el registro se conserva y el reintento con la misma clave de idempotencia
		// lo reconcilia (el replay devuelve también los buckets pausados).
		if (!reintento && rechazada) {
			await db
				.delete(ausenciasAsesorCobros)
				.where(
					and(
						eq(ausenciasAsesorCobros.id, params.id),
						isNull(ausenciasAsesorCobros.operacionTrasladoId),
					),
				);
		}
		traducirErrorCartera(error);
	}

	// El traslado y la salida del pool son una sola operación en cartera-back.
	// Upsert: si otra llamada con el mismo id borró el registro pendiente mientras
	// esta confirmaba, el traslado ya está hecho y el pool pausado en cartera, así
	// que el registro se vuelve a crear en vez de quedar sin ausencia en el CRM.
	const datosTraslado = {
		operacionTrasladoId: operacionId,
		cuentasRepartidas: cuentas,
		bucketsPausados: buckets,
		poolPausado: true,
	};
	await db
		.insert(ausenciasAsesorCobros)
		.values({
			id: params.id,
			asesorId: params.asesorId,
			titularId,
			motivo: params.motivo,
			nota: params.nota || null,
			creadaPor: params.actor.userId,
			...datosTraslado,
		})
		.onConflictDoUpdate({
			target: ausenciasAsesorCobros.id,
			set: datosTraslado,
		});
	try {
		await reconciliarAvisosLlamarCliente();
	} catch (error) {
		console.warn(
			"[ausencias] No se reconciliaron los avisos de llamadas:",
			error,
		);
	}
	return db
		.select()
		.from(ausenciasAsesorCobros)
		.where(eq(ausenciasAsesorCobros.id, params.id))
		.limit(1)
		.then((r) => r[0]);
}

export async function reactivarAsesor(params: { id: string; actor: Actor }) {
	const [encontrada] = await db
		.select()
		.from(ausenciasAsesorCobros)
		.where(eq(ausenciasAsesorCobros.id, params.id))
		.limit(1);
	if (!encontrada) {
		throw new ORPCError("NOT_FOUND", {
			message: "No se encontró la ausencia.",
		});
	}
	if (encontrada.estado !== "vigente") {
		throw new ORPCError("CONFLICT", {
			message: "Este asesor ya fue reactivado. Actualice la vista.",
		});
	}
	// Sin traslado registrado la confirmación quedó en duda: se concilia con
	// cartera y, si no se puede asegurar, no se cierra la ausencia.
	let ausencia = encontrada;
	if (!ausencia.operacionTrasladoId) {
		const conciliada = await reconciliarPendiente(ausencia.id).catch(
			() => null,
		);
		if (!conciliada) {
			const vencida =
				Date.now() - ausencia.inicioAt.getTime() > PENDIENTE_VENCE_MS;
			if (vencida) {
				await descartarPendientesVencidas(ausencia.asesorId);
				// El helper conserva la fila si no pudo preguntar a cartera (o si la
				// conciliación sí encontró el traslado): solo se afirma el descarte si
				// de verdad ya no existe.
				const [sigue] = await db
					.select({ id: ausenciasAsesorCobros.id })
					.from(ausenciasAsesorCobros)
					.where(eq(ausenciasAsesorCobros.id, ausencia.id))
					.limit(1);
				if (sigue) {
					throw new ORPCError("CONFLICT", {
						message:
							"No se pudo confirmar con cartera si la ausencia llegó a confirmarse. Intente de nuevo en unos minutos.",
					});
				}
				throw new ORPCError("CONFLICT", {
					message:
						"La ausencia nunca se confirmó y se descartó: el asesor no tiene cartera repartida ni está fuera del pool.",
				});
			}
			throw new ORPCError("CONFLICT", {
				message:
					"La ausencia está pendiente de confirmar. Reintente marcarla ausente con la misma solicitud antes de reactivar.",
			});
		}
		ausencia = conciliada;
	}
	const nombre = await asesorConUsuario(ausencia.asesorId)
		.then((a) => a.nombre)
		.catch(() => null);

	try {
		// 0. Se deja constancia de que la reactivación empezó. Cartera es otro sistema:
		// si reanuda el pool y la respuesta se pierde, o el cierre de abajo falla, la
		// ausencia sigue «vigente» y con esta marca se sabe que hay que repetir la
		// reactivación (todos los pasos son idempotentes) en vez de dejarla abierta
		// con el asesor ya elegible en cartera.
		await db
			.update(ausenciasAsesorCobros)
			.set({ reactivacionIniciadaAt: new Date() })
			.where(
				and(
					eq(ausenciasAsesorCobros.id, params.id),
					eq(ausenciasAsesorCobros.estado, "vigente"),
					isNull(ausenciasAsesorCobros.reactivacionIniciadaAt),
				),
			);
		// 1. Lo repartido vuelve, salvo lo que ya cambió de dueño o de bucket. El pool
		// sigue PAUSADO mientras tanto: así el asesor no recibe cuentas nuevas en medio
		// de la devolución, y si esta falla no hay nada que deshacer.
		const devolucion = ausencia.operacionTrasladoId
			? await carteraBackClient.devolverTrasladoCartera(
					ausencia.operacionTrasladoId,
					{
						motivo: motivoDeLaDevolucion(nombre),
						usuario_email: params.actor.email,
					},
				)
			: { devueltos: 0, retenidos: [] as unknown[], total: 0 };

		// 2. Recién entonces vuelve al pool y al balanceo de créditos (una sola
		// transacción en cartera-back, idempotente). Si la respuesta se pierde, el
		// reintento de la reactivación lo repite sin efecto.
		if (ausencia.poolPausado) {
			await carteraBackClient.reanudarPoolAsesor(
				ausencia.asesorId,
				ausencia.bucketsPausados,
				ausencia.operacionTrasladoId ?? undefined,
			);
		}

		const [cerrada] = await db
			.update(ausenciasAsesorCobros)
			.set({
				estado: "reactivada",
				finAt: new Date(),
				// Recién ahora termina la pausa: hasta aquí el registro la conserva.
				poolPausado: false,
				cuentasDevueltas: devolucion.devueltos,
				cuentasRetenidas: devolucion.retenidos.length,
				reactivadaPor: params.actor.userId,
			})
			.where(
				and(
					eq(ausenciasAsesorCobros.id, params.id),
					eq(ausenciasAsesorCobros.estado, "vigente"),
				),
			)
			.returning();

		// Otra reactivación simultánea ganó la carrera: no se avisa dos veces ni se
		// reporta éxito (las operaciones de cartera son idempotentes).
		if (!cerrada) {
			throw new ORPCError("CONFLICT", {
				message: "Este asesor ya fue reactivado. Actualice la vista.",
			});
		}

		try {
			await reconciliarAvisosLlamarCliente();
		} catch (error) {
			console.warn(
				"[ausencias] No se reconciliaron los avisos de llamadas:",
				error,
			);
		}
		await avisarAlEquipo({
			nombre,
			asesorId: ausencia.asesorId,
			devueltas: devolucion.devueltos,
			retenidas: devolucion.retenidos.length,
			actor: params.actor,
		});
		return {
			ausencia: cerrada,
			devueltas: devolucion.devueltos,
			retenidas: devolucion.retenidos,
		};
	} catch (error) {
		if (error instanceof ORPCError) throw error;
		traducirErrorCartera(error);
	}
}

/** Aviso automático al resto del equipo y a los supervisores (best-effort). */
async function avisarAlEquipo(params: {
	nombre: string | null;
	asesorId: number;
	devueltas: number;
	retenidas: number;
	actor: Actor;
}) {
	try {
		const [mapa, supervisores] = await Promise.all([
			construirMapaAsesorUsuario(),
			obtenerSupervisoresCobros(),
		]);
		const destinatarios = new Set<string>(supervisores);
		for (const [asesorId, userId] of mapa) {
			if (asesorId !== params.asesorId) destinatarios.add(userId);
		}
		destinatarios.delete(params.actor.userId);
		if (destinatarios.size === 0) return;
		const { titulo, descripcion } = textoAvisoReactivacion(params);
		const esSupervisor = new Set(supervisores);
		await db.insert(notifications).values(
			[...destinatarios].map((assignedTo) => ({
				titulo,
				descripcion,
				type: "aviso" as const,
				status: "pending" as const,
				cobrosTipo: "asesor_reactivado" as const,
				createdBy: params.actor.userId,
				createdByRole: params.actor.role,
				assignedToRole: esSupervisor.has(assignedTo)
					? ("cobros_supervisor" as const)
					: ("cobros" as const),
				assignedTo,
			})),
		);
	} catch (error) {
		console.warn(
			"[ausencias] No se pudo avisar al equipo (best-effort):",
			error instanceof Error ? error.message : error,
		);
	}
}

/** Ausencias con el nombre del asesor; por defecto solo las vigentes. */
export async function listarAusencias(params: { soloVigentes: boolean }) {
	const filas = await db
		.select({
			id: ausenciasAsesorCobros.id,
			asesorId: ausenciasAsesorCobros.asesorId,
			titularId: ausenciasAsesorCobros.titularId,
			titularNombre: user.name,
			motivo: ausenciasAsesorCobros.motivo,
			nota: ausenciasAsesorCobros.nota,
			inicioAt: ausenciasAsesorCobros.inicioAt,
			finAt: ausenciasAsesorCobros.finAt,
			estado: ausenciasAsesorCobros.estado,
			cuentasRepartidas: ausenciasAsesorCobros.cuentasRepartidas,
			cuentasDevueltas: ausenciasAsesorCobros.cuentasDevueltas,
			cuentasRetenidas: ausenciasAsesorCobros.cuentasRetenidas,
			poolPausado: ausenciasAsesorCobros.poolPausado,
			// No nulo en una ausencia vigente = reactivación a medias: repetir «Reactivar».
			reactivacionIniciadaAt: ausenciasAsesorCobros.reactivacionIniciadaAt,
		})
		.from(ausenciasAsesorCobros)
		.leftJoin(user, eq(ausenciasAsesorCobros.titularId, user.id))
		.where(
			params.soloVigentes
				? eq(ausenciasAsesorCobros.estado, "vigente")
				: undefined,
		)
		.orderBy(desc(ausenciasAsesorCobros.inicioAt))
		.limit(200);
	return filas;
}
