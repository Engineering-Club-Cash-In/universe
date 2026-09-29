/**
 * CB-037 / CB-038 · La parte con efectos de las visitas de cobros: quién puede
 * ir, la verificación de las fotos, los vínculos con la promesa y la entrega
 * que salen de la visita, y los avisos al responsable. Las reglas puras viven
 * en lib/visitas-cobros.ts.
 *
 * El responsable sigue la regla de la casa (asignación = cartera): puede ir a
 * la visita quien puede trabajar el crédito —el dueño en cartera, quien lo
 * cubre hoy o un supervisor—. Asignarle una visita a alguien no le da acceso a
 * la ficha; por eso no se ofrece a quien no lo tiene.
 */

import { ORPCError } from "@orpc/server";
import {
	and,
	asc,
	desc,
	eq,
	gte,
	inArray,
	isNull,
	lt,
	ne,
	sql,
} from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { casosCobros } from "../db/schema/cobros";
import { leads, opportunities } from "../db/schema/crm";
import { notifications } from "../db/schema/notifications";
import { visitasCobros } from "../db/schema/visitas-cobros";
import { usuarioDuenoEnCarteraEstricto } from "../lib/acceso-caso-cobro";
import { gtDateStrToDate, toDateStrGT } from "../lib/guatemala-month-window";
import {
	buildUploadPrefix,
	MAX_FILE_SIZE,
	verifyUploadedDocumentInR2,
} from "../lib/storage";
import {
	type EstadoVisita,
	MIME_EVIDENCIA_VISITA,
	type RegistrarVisita,
	type ResultadoVisita,
	siguientesPasos,
	type TipoVisita,
	textoAvisoVisitaProgramada,
} from "../lib/visitas-cobros";
import { obtenerCoberturasVigentes } from "./agenda-cobros-source";
import { carteraBackClient } from "./cartera-back-client";
import { isCarteraBackEnabled } from "./cartera-back-integration";
import { filasNotificacionCobros } from "./cobros-notif-helpers";

// ── Bucket ──────────────────────────────────────────────────────────────────

/**
 * El bucket de HOY, sin cache. Falla cerrado: sin bucket confirmado no se
 * agenda ni se registra una visita nueva (mismo criterio que la entrega en B4).
 */
export async function bucketActualEstricto(
	numeroSifco: string,
): Promise<number | null> {
	if (!isCarteraBackEnabled()) {
		throw new ORPCError("SERVICE_UNAVAILABLE", {
			message: "Cartera no está disponible: no se puede confirmar el bucket.",
		});
	}
	try {
		return (
			(await carteraBackClient.getBucketActualCredito(numeroSifco))?.bucket ??
			null
		);
	} catch (error) {
		console.error(
			`[visitas-cobros] No se pudo leer el bucket de ${numeroSifco}:`,
			error,
		);
		throw new ORPCError("SERVICE_UNAVAILABLE", {
			message: "No se pudo confirmar el bucket del crédito. Intentá de nuevo.",
		});
	}
}

/** Para el snapshot de la gestión: si cartera no contesta, null y se sigue. */
export async function bucketActualTolerante(
	numeroSifco: string | null,
): Promise<number | null> {
	if (!numeroSifco || !isCarteraBackEnabled()) return null;
	try {
		return (
			(await carteraBackClient.getBucketActualCredito(numeroSifco))?.bucket ??
			null
		);
	} catch {
		return null;
	}
}

// ── Responsable ─────────────────────────────────────────────────────────────

export type ResponsableVisita = {
	id: string;
	nombre: string;
	/** Por qué puede ir: el texto que ve el asesor al lado del nombre. */
	motivo: "lleva el crédito" | "lo cubre hoy" | "supervisor" | "vos";
};

/**
 * Quién puede ir a la visita: el dueño en cartera, quien lo cubre hoy y los
 * supervisores de cobros. Un admin (ve todo, pero no está en el equipo de
 * campo) se agrega solo a sí mismo. Lanza SERVICE_UNAVAILABLE si cartera no
 * contesta: sin dueño confirmado no se puede decidir.
 */
export async function responsablesPosiblesVisita(params: {
	numeroSifco: string | null;
	actor: { userId: string; userRole: string };
}): Promise<ResponsableVisita[]> {
	const dueno = await usuarioDuenoEnCarteraEstricto(params.numeroSifco);
	const suplentes = dueno
		? (await obtenerCoberturasVigentes(dueno, toDateStrGT(new Date())))
				.filter((c) => c.titularId === dueno)
				.map((c) => c.suplenteId)
		: [];

	const supervisores = await db
		.select({ id: user.id, nombre: user.name })
		.from(user)
		.where(
			and(eq(user.role, "cobros_supervisor"), sql`${user.banned} IS NOT TRUE`),
		)
		.orderBy(asc(user.name));

	const idsSueltos = [
		...new Set(
			[dueno, ...suplentes, params.actor.userId].filter((id): id is string =>
				Boolean(id),
			),
		),
	];
	const nombres = new Map(
		(idsSueltos.length > 0
			? await db
					.select({ id: user.id, nombre: user.name, banned: user.banned })
					.from(user)
					.where(inArray(user.id, idsSueltos))
			: []
		)
			.filter((u) => u.banned !== true)
			.map((u) => [u.id, u.nombre]),
	);

	const lista: ResponsableVisita[] = [];
	const agregar = (
		id: string,
		nombre: string | undefined,
		motivo: ResponsableVisita["motivo"],
	) => {
		if (!nombre || lista.some((r) => r.id === id)) return;
		lista.push({ id, nombre, motivo });
	};
	if (dueno) agregar(dueno, nombres.get(dueno), "lleva el crédito");
	for (const s of suplentes) agregar(s, nombres.get(s), "lo cubre hoy");
	for (const s of supervisores) agregar(s.id, s.nombre, "supervisor");
	if (params.actor.userRole === "admin") {
		agregar(params.actor.userId, nombres.get(params.actor.userId), "vos");
	}
	return lista;
}

export function assertResponsablePosible(
	responsableId: string,
	posibles: readonly ResponsableVisita[],
): void {
	if (!posibles.some((r) => r.id === responsableId)) {
		throw new ORPCError("BAD_REQUEST", {
			message:
				"Esa persona no trabaja este crédito: elegí a quien lo lleva en cartera, a quien lo cubre hoy o a un supervisor.",
		});
	}
}

// ── Evidencia ───────────────────────────────────────────────────────────────

export type EvidenciaVerificada = {
	key: string;
	nombreArchivo: string;
	mimeType: string;
	tamanoBytes: number;
};

/**
 * Cada foto tiene que existir en R2, bajo la carpeta de ESTE caso, ser una
 * imagen y no estar ya en otra visita. La carpeta la fija la URL firmada que
 * pidió el navegador (`cobros_visita_evidencia` + caso), así que una key de
 * otro caso o de otro módulo no pasa.
 */
export async function verificarEvidencias(
	casoCobroId: string,
	evidencias: RegistrarVisita["evidencias"],
): Promise<EvidenciaVerificada[]> {
	if (evidencias.length === 0) return [];
	const prefijo = buildUploadPrefix("cobros_visita_evidencia", casoCobroId);
	const verificadas: EvidenciaVerificada[] = [];
	for (const e of evidencias) {
		const r = await verifyUploadedDocumentInR2({
			key: e.key,
			expectedPrefix: prefijo,
			filename: e.nombreArchivo,
			maxSizeBytes: MAX_FILE_SIZE,
		});
		if (!(MIME_EVIDENCIA_VISITA as readonly string[]).includes(r.mimeType)) {
			throw new ORPCError("BAD_REQUEST", {
				message: `«${e.nombreArchivo}» no es una foto (JPG, PNG o WebP).`,
			});
		}
		verificadas.push({
			key: r.key,
			nombreArchivo: e.nombreArchivo,
			mimeType: r.mimeType,
			tamanoBytes: r.size,
		});
	}
	return verificadas;
}

// ── Vínculos con la promesa y la entrega ────────────────────────────────────

type Seguimiento = "promesa" | "entrega";

/**
 * La visita desde la que se registra una promesa o una entrega: del mismo
 * caso, realizada, con un resultado que la pide y sin una ya vinculada. Se
 * revisa ANTES de crear la promesa o de llamar a cartera, para no dejar una
 * promesa o un traslado colgados de una visita equivocada.
 */
export async function assertVisitaParaSeguimiento(params: {
	visitaId: string;
	casoCobroId: string;
	seguimiento: Seguimiento;
}): Promise<void> {
	const [visita] = await db
		.select({
			casoCobroId: visitasCobros.casoCobroId,
			estado: visitasCobros.estado,
			resultado: visitasCobros.resultado,
			promesaContactoId: visitasCobros.promesaContactoId,
			recuperacionId: visitasCobros.recuperacionId,
		})
		.from(visitasCobros)
		.where(eq(visitasCobros.id, params.visitaId))
		.limit(1);
	if (!visita || visita.casoCobroId !== params.casoCobroId) {
		throw new ORPCError("BAD_REQUEST", {
			message: "La visita no es de este caso.",
		});
	}
	const pasos =
		visita.estado === "realizada" && visita.resultado
			? siguientesPasos(visita.resultado as ResultadoVisita)
			: null;
	if (params.seguimiento === "promesa") {
		if (!pasos?.promesa) {
			throw new ORPCError("BAD_REQUEST", {
				message: "El resultado de esa visita no fue una promesa.",
			});
		}
		// Una promesa ya vinculada no se re-vincula a otra: la promesa activa se
		// edita desde su propia tarjeta.
		if (visita.promesaContactoId) {
			throw new ORPCError("CONFLICT", {
				message: "Esa visita ya tiene su promesa registrada.",
			});
		}
		return;
	}
	if (!pasos?.entrega) {
		throw new ORPCError("BAD_REQUEST", {
			message: "El resultado de esa visita no fue una entrega voluntaria.",
		});
	}
	if (visita.recuperacionId) {
		throw new ORPCError("CONFLICT", {
			message: "Esa visita ya tiene su entrega voluntaria registrada.",
		});
	}
}

/**
 * Anota la promesa en la visita. Best-effort: la promesa ya existe y es lo
 * que importa; si esto falla, la visita sigue mostrando "falta la promesa" y
 * al reintentar el modal abre la promesa activa en edición, que la vincula.
 */
export async function vincularPromesaAVisita(
	visitaId: string,
	promesaContactoId: string,
): Promise<void> {
	try {
		await db
			.update(visitasCobros)
			.set({ promesaContactoId, updatedAt: new Date() })
			.where(
				and(
					eq(visitasCobros.id, visitaId),
					isNull(visitasCobros.promesaContactoId),
				),
			);
	} catch (error) {
		console.error(
			`[visitas-cobros] No se pudo vincular la promesa ${promesaContactoId} a la visita ${visitaId}:`,
			error,
		);
	}
}

/**
 * Anota la entrega voluntaria en la visita, DENTRO de la transacción que crea
 * el registro de recuperación. Si otra solicitud ya la vinculó (doble clic),
 * lanza y el registro nuevo se revierte antes de llamar a cartera.
 */
export async function vincularRecuperacionAVisita(
	tx: Pick<typeof db, "update">,
	visitaId: string,
	recuperacionId: string,
): Promise<void> {
	const filas = await tx
		.update(visitasCobros)
		.set({ recuperacionId, updatedAt: new Date() })
		.where(
			and(eq(visitasCobros.id, visitaId), isNull(visitasCobros.recuperacionId)),
		)
		.returning({ id: visitasCobros.id });
	if (filas.length === 0) {
		throw new ORPCError("CONFLICT", {
			message: "Esa visita ya tiene su entrega voluntaria registrada.",
		});
	}
}

// ── Avisos ──────────────────────────────────────────────────────────────────

/** Nombre del cliente por el puente de siempre (SIFCO → oportunidad → lead). */
async function nombreClientePorSifco(
	numeroSifco: string | null,
): Promise<string | null> {
	if (!numeroSifco) return null;
	const [fila] = await db
		.select({ nombre: leads.firstName, apellido: leads.lastName })
		.from(opportunities)
		.innerJoin(leads, eq(opportunities.leadId, leads.id))
		.where(eq(opportunities.numeroSifco, numeroSifco))
		.orderBy(
			sql`CASE WHEN ${opportunities.status} IN ('won', 'migrate') THEN 0 ELSE 1 END`,
			desc(opportunities.createdAt),
		)
		.limit(1);
	const nombre = `${fila?.nombre ?? ""} ${fila?.apellido ?? ""}`.trim();
	return nombre || null;
}

/**
 * Aviso al responsable de una visita programada. Al programarla solo si la
 * programó otro (uno no se avisa a sí mismo); la mañana del día, siempre.
 * Best-effort: un aviso que no sale no deshace la visita. Dedup por visita (y
 * por día en el de la mañana): un reintento o un segundo run no duplica.
 */
export async function avisarVisitaProgramada(params: {
	visitaId: string;
	casoCobroId: string;
	numeroSifco: string | null;
	tipo: TipoVisita;
	fechaProgramada: Date;
	direccion: string;
	responsableId: string;
	/** Quién la programó (created_by del aviso). */
	programadaPorId: string;
	esHoy: boolean;
}): Promise<void> {
	if (!params.esHoy && params.responsableId === params.programadaPorId) return;
	try {
		const [programador] = await db
			.select({ name: user.name })
			.from(user)
			.where(eq(user.id, params.programadaPorId))
			.limit(1);
		const { titulo, descripcion } = textoAvisoVisitaProgramada({
			tipo: params.tipo,
			cliente: await nombreClientePorSifco(params.numeroSifco),
			numeroSifco: params.numeroSifco,
			fechaProgramada: params.fechaProgramada,
			direccion: params.direccion,
			programadaPor:
				params.responsableId === params.programadaPorId
					? null
					: (programador?.name ?? null),
			esHoy: params.esHoy,
		});
		const filas = filasNotificacionCobros({
			casoId: params.casoCobroId,
			cobrosTipo: "visita_programada",
			titulo,
			descripcion,
			asesorUserId: params.responsableId,
			supervisores: [],
			usuarioSistema: params.programadaPorId,
			dedupKey: params.esHoy
				? `visita:${params.visitaId}:dia:${toDateStrGT(params.fechaProgramada)}`
				: `visita:${params.visitaId}:programada`,
		});
		if (filas.length > 0) {
			await db.insert(notifications).values(filas).onConflictDoNothing();
		}
	} catch (error) {
		console.error(
			`[visitas-cobros] No se pudo avisar la visita ${params.visitaId}:`,
			error,
		);
	}
}

/** La visita ya se registró o se canceló: sus avisos dejan de estar pendientes. */
export async function resolverAvisosDeVisita(visitaId: string): Promise<void> {
	try {
		await db
			.update(notifications)
			.set({
				status: "resolved",
				resolvedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(
				and(
					eq(notifications.cobrosTipo, "visita_programada"),
					sql`${notifications.cobrosDedupKey} LIKE ${`visita:${visitaId}:%`}`,
					ne(notifications.status, "resolved"),
				),
			);
	} catch (error) {
		console.error(
			`[visitas-cobros] No se pudieron cerrar los avisos de la visita ${visitaId}:`,
			error,
		);
	}
}

/**
 * Job de la mañana (08:00 GT, junto con las demás alertas de cobros): aviso al
 * responsable de cada visita programada para hoy. El dedup por día hace que el
 * run de boot no duplique.
 */
export async function avisarVisitasDelDia(
	ahora: Date = new Date(),
): Promise<number> {
	const inicio = gtDateStrToDate(toDateStrGT(ahora));
	const fin = new Date(inicio.getTime() + 86_400_000);
	const visitas = await db
		.select({
			id: visitasCobros.id,
			casoCobroId: visitasCobros.casoCobroId,
			tipo: visitasCobros.tipo,
			fechaProgramada: visitasCobros.fechaProgramada,
			direccion: visitasCobros.direccion,
			responsableId: visitasCobros.responsableId,
			programadaPor: visitasCobros.programadaPor,
			numeroSifco: casosCobros.numeroCreditoSifco,
		})
		.from(visitasCobros)
		.innerJoin(casosCobros, eq(visitasCobros.casoCobroId, casosCobros.id))
		.where(
			and(
				eq(visitasCobros.estado, "programada" satisfies EstadoVisita),
				gte(visitasCobros.fechaProgramada, inicio),
				lt(visitasCobros.fechaProgramada, fin),
			),
		);
	for (const v of visitas) {
		if (!v.fechaProgramada) continue;
		await avisarVisitaProgramada({
			visitaId: v.id,
			casoCobroId: v.casoCobroId,
			numeroSifco: v.numeroSifco,
			tipo: v.tipo as TipoVisita,
			fechaProgramada: v.fechaProgramada,
			direccion: v.direccion,
			responsableId: v.responsableId,
			programadaPorId: v.programadaPor ?? v.responsableId,
			esHoy: true,
		});
	}
	return visitas.length;
}
