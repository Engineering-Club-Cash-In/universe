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
import { and, desc, eq, gte, isNull } from "drizzle-orm";
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

async function ausenciaVigente(asesorId: number) {
	const [fila] = await db
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

/** No se marca ausente a quien ya lo está ni a quien tiene una cobertura abierta. */
async function validarQueSePuedeMarcar(
	asesorId: number,
	titularUserId: string | null,
) {
	if (await ausenciaVigente(asesorId)) {
		throw new ORPCError("CONFLICT", {
			message: "Este asesor ya está marcado como ausente.",
		});
	}
	if (!titularUserId) return;
	const hoy = toDateStrGT(new Date());
	const [cobertura] = await db
		.select({ id: coberturasAgendaCobros.id })
		.from(coberturasAgendaCobros)
		.where(
			and(
				eq(coberturasAgendaCobros.titularId, titularUserId),
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
	const { userId } = await asesorConUsuario(params.asesorId);
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
	// Reintento del mismo clic: si ya se repartió, se devuelve lo hecho.
	if (existente?.operacionTrasladoId) return existente;

	const { userId: titularId } = await asesorConUsuario(params.asesorId);
	if (!existente) {
		await validarQueSePuedeMarcar(params.asesorId, titularId);
		try {
			await db.insert(ausenciasAsesorCobros).values({
				id: params.id,
				asesorId: params.asesorId,
				titularId,
				motivo: params.motivo,
				nota: params.nota || null,
				creadaPor: params.actor.userId,
			});
		} catch (error) {
			// Índice único: otra ausencia vigente ganó la carrera.
			throw new ORPCError("CONFLICT", {
				message: "Este asesor ya está marcado como ausente.",
			});
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
		});
		operacionId = res.operacionId;
		cuentas = res.cuentas;
		buckets = res.bucketsPausados ?? [];
	} catch (error) {
		// Solo se quita la ausencia si cartera-back RECHAZÓ el traslado (400/404/409):
		// ahí no se repartió nada ni se pausó el pool. Ante un timeout, corte de
		// conexión o 5xx el traslado pudo confirmarse sin que llegara la respuesta:
		// el registro se conserva y el reintento con la misma clave de idempotencia
		// lo reconcilia (el replay devuelve también los buckets pausados).
		if (
			error instanceof CarteraBackHttpError &&
			(error.status === 400 || error.status === 404 || error.status === 409)
		) {
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
	await db
		.update(ausenciasAsesorCobros)
		.set({
			operacionTrasladoId: operacionId,
			cuentasRepartidas: cuentas,
			bucketsPausados: buckets,
			poolPausado: true,
		})
		.where(eq(ausenciasAsesorCobros.id, params.id));
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
	const [ausencia] = await db
		.select()
		.from(ausenciasAsesorCobros)
		.where(eq(ausenciasAsesorCobros.id, params.id))
		.limit(1);
	if (!ausencia) {
		throw new ORPCError("NOT_FOUND", {
			message: "No se encontró la ausencia.",
		});
	}
	if (ausencia.estado !== "vigente") {
		throw new ORPCError("CONFLICT", {
			message: "Este asesor ya fue reactivado. Actualice la vista.",
		});
	}
	const nombre = await asesorConUsuario(ausencia.asesorId)
		.then((a) => a.nombre)
		.catch(() => null);

	try {
		// 1. De vuelta al pool: la devolución exige que esté activo en el bucket.
		if (ausencia.poolPausado) {
			await carteraBackClient.reanudarPoolAsesor(
				ausencia.asesorId,
				ausencia.bucketsPausados,
			);
			await db
				.update(ausenciasAsesorCobros)
				.set({ poolPausado: false })
				.where(eq(ausenciasAsesorCobros.id, params.id));
		}
		// 2. Lo repartido vuelve, salvo lo que ya cambió de dueño o de bucket.
		const devolucion = ausencia.operacionTrasladoId
			? await carteraBackClient.devolverTrasladoCartera(
					ausencia.operacionTrasladoId,
					{
						motivo: motivoDeLaDevolucion(nombre),
						usuario_email: params.actor.email,
					},
				)
			: { devueltos: 0, retenidos: [] as unknown[], total: 0 };

		const [cerrada] = await db
			.update(ausenciasAsesorCobros)
			.set({
				estado: "reactivada",
				finAt: new Date(),
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
