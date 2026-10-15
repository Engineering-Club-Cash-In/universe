/**
 * Alta y baja de asesor desde «Mi equipo» (Figma «05 · Alta y Baja de Asesor»).
 * Reglas puras y textos en lib/alta-baja-asesor.ts.
 *
 * ALTA (`crearAsesorCobros`), en este orden y reintentable de punta a punta
 * (cada paso es idempotente; repetir la misma solicitud retoma donde quedó):
 *   1. Usuario del CRM con rol Cobros: se crea, se vincula (ya existe) o se
 *      vuelve a habilitar (suspendido por una baja). Va PRIMERO: un asesor en el
 *      pool recibe créditos del motor y necesita poder entrar a verlos.
 *   2. Asesor en cartera con su `email_cash_in`, su supervisor y el pool del
 *      nivel (POST /buckets/asesores/alta, una transacción, idempotente por correo).
 *   3. Cartera inicial: N créditos de los asesores del nivel con más carga, con la
 *      reasignación en bloque (S6, todo o nada). Solo se mueve lo que falta para
 *      llegar a N: si un intento anterior ya movió el lote, no se duplica.
 *   CRM y cartera son dos bases: no hay una transacción que cubra los tres pasos.
 *   Si uno falla, lo anterior queda hecho y el mensaje lo dice; repetir el alta
 *   con los mismos datos completa lo que falta.
 *
 * BAJA (`previsualizarBajaAsesor` → `confirmarBajaAsesor`):
 *   1. Previsualización: traslado `redistribucion` por capacidad de cartera
 *      (el mismo de la ausencia M5) con `pausarPoolOrigen` y `desactivarOrigen`.
 *      Las cuentas fuera de cobro van a un responsable (sugerido o elegido).
 *   2. Confirmación: UNA transacción de cartera reparte TODOS sus créditos (falla
 *      si alguno queda sin destino), lo saca del pool y lo desactiva.
 *   3. Su usuario del CRM queda suspendido y sin sesiones. Si esto falla, repetir
 *      la confirmación (misma clave) no repite el reparto y vuelve a suspender.
 */

import { ORPCError } from "@orpc/server";
import { and, eq, gte, isNull, or, sql } from "drizzle-orm";
import { db } from "../db";
import { session, user } from "../db/schema/auth";
import {
	ausenciasAsesorCobros,
	coberturasAgendaCobros,
} from "../db/schema/cobros";
import {
	BUCKETS_POR_ROL,
	capacidadSugeridaPorBucket,
	DOMINIO_CORREO_CRM,
	ETIQUETA_ROL_ASESOR,
	elegirCreditosDonante,
	evaluarUsuarioAlta,
	MAX_CARTERA_INICIAL,
	type MiembroEquipo,
	type MotivoBaja,
	motivoDeLaBaja,
	normalizarCorreo,
	planCarteraInicial,
	type RolAsesor,
	recomendarCarteraInicial,
	resumenRedistribucion,
	sugerirResponsableEspeciales,
	type UsuarioAlta,
} from "../lib/alta-baja-asesor";
import { auth } from "../lib/auth";
import { toDateStrGT } from "../lib/guatemala-month-window";
import { nivelPorBuckets } from "../lib/nivel-asesor";
import { ROLES } from "../lib/roles";
import type {
	CargaPorAsesorBucketResponse,
	PoolPorAsesorRow,
} from "../types/cartera-back";
import { CarteraBackHttpError, carteraBackClient } from "./cartera-back-client";
import { reconciliarAvisosLlamarCliente } from "./inmovilizacion-notif";

export type ActorEquipo = {
	userId: string;
	role: string | null | undefined;
	email: string;
};

/** 400/404/409 de cartera llegan con un mensaje que el supervisor puede leer. */
function traducirErrorCartera(error: unknown, prefijo = ""): never {
	if (
		error instanceof CarteraBackHttpError &&
		(error.status === 400 || error.status === 404 || error.status === 409)
	) {
		const mensaje = (error.payload?.message ?? error.message).replace(
			/\[ERROR\]\s*/g,
			"",
		);
		throw new ORPCError(
			error.status === 400
				? "BAD_REQUEST"
				: error.status === 404
					? "NOT_FOUND"
					: "CONFLICT",
			{ message: `${prefijo}${mensaje}` },
		);
	}
	throw error;
}

/* ── Lecturas compartidas ─────────────────────────────────────────────── */

const cargaEnBuckets = (
	carga: CargaPorAsesorBucketResponse,
	asesorId: number,
	buckets?: readonly number[],
) =>
	(carga.porAsesor.find((a) => a.asesor_id === asesorId)?.porBucket ?? [])
		.filter((d) => !buckets || buckets.includes(d.bucket))
		.reduce((t, d) => t + d.cuentas, 0);

/** Asesores activos de cartera con ese nivel (sin `excluir`), con su carga en el nivel. */
function equipoDelRol(
	pool: readonly PoolPorAsesorRow[],
	carga: CargaPorAsesorBucketResponse,
	rol: RolAsesor,
	excluir?: number,
): MiembroEquipo[] {
	const buckets = BUCKETS_POR_ROL[rol];
	return pool
		.filter(
			(a) =>
				a.activo !== false &&
				a.asesor_id !== excluir &&
				nivelPorBuckets(a.buckets) === rol,
		)
		.map((a) => ({
			asesorId: a.asesor_id,
			nombre: a.nombre,
			carga: cargaEnBuckets(carga, a.asesor_id, buckets),
		}))
		.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

async function usuarioPorCorreo(email: string) {
	const [u] = await db
		.select({
			id: user.id,
			name: user.name,
			email: user.email,
			role: user.role,
			banned: user.banned,
			banReason: user.banReason,
		})
		.from(user)
		.where(sql`lower(trim(${user.email})) = ${email}`)
		.limit(1);
	return u ?? null;
}

/** Supervisores de cobros habilitados (opciones del campo «Supervisor»). */
export async function listarSupervisoresCobros() {
	const filas = await db
		.select({ userId: user.id, nombre: user.name, email: user.email })
		.from(user)
		.where(
			and(
				eq(user.role, ROLES.COBROS_SUPERVISOR),
				or(isNull(user.banned), eq(user.banned, false)),
			),
		);
	return filas.sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

/* ── Alta ──────────────────────────────────────────────────────────────── */

export type DatosAlta = { nombre: string; email: string; rol: RolAsesor };

/**
 * Lo que necesita «Cartera inicial»: qué pasa con el usuario del CRM, si el
 * correo ya es de un asesor de cartera, el equipo del nivel con su carga y la
 * recomendación. No escribe nada.
 */
export async function previsualizarAltaAsesor(
	datos: DatosAlta,
	actor: ActorEquipo,
) {
	const email = normalizarCorreo(datos.email);
	if (!email.endsWith(DOMINIO_CORREO_CRM)) {
		throw new ORPCError("BAD_REQUEST", {
			message: `Ingrese el correo ${DOMINIO_CORREO_CRM} del asesor.`,
		});
	}
	const buckets = BUCKETS_POR_ROL[datos.rol];
	const [u, pool, carga] = await Promise.all([
		usuarioPorCorreo(email),
		carteraBackClient.getPoolPorAsesor({ useCache: false }),
		carteraBackClient.getCargaPorAsesorBucket({}),
	]);
	const evaluado = evaluarUsuarioAlta(u, actor.role === ROLES.ADMIN);

	// ¿El correo ya es de un asesor de cartera?
	const mismos = pool.filter(
		(a) => a.email_cash_in?.trim().toLowerCase() === email,
	);
	const activos = mismos.filter((a) => a.activo !== false);
	let bloqueoCartera: string | null = null;
	let asesorExistente: { asesorId: number; carga: number } | null = null;
	const activo = activos[0];
	if (activos.length > 1) {
		bloqueoCartera =
			"Hay más de un asesor activo con ese correo en cartera. Corríjalo antes de dar de alta.";
	} else if (activo && activo.buckets.length > 0) {
		const mismoPool =
			activo.buckets.length === buckets.length &&
			buckets.every((b) => activo.buckets.includes(b));
		if (mismoPool) {
			// Un alta que quedó a medias: se retoma (no se duplica nada).
			asesorExistente = {
				asesorId: activo.asesor_id,
				carga: cargaEnBuckets(carga, activo.asesor_id, buckets),
			};
		} else {
			const nivel = nivelPorBuckets(activo.buckets);
			bloqueoCartera = `${activo.nombre} ya es asesor activo de cobros${nivel ? ` (${ETIQUETA_ROL_ASESOR[nivel]})` : ""}.`;
		}
	} else if (activo) {
		const [ausente] = await db
			.select({ id: ausenciasAsesorCobros.id })
			.from(ausenciasAsesorCobros)
			.where(
				and(
					eq(ausenciasAsesorCobros.asesorId, activo.asesor_id),
					eq(ausenciasAsesorCobros.estado, "vigente"),
				),
			)
			.limit(1);
		if (ausente) {
			bloqueoCartera = `${activo.nombre} está ausente con su cartera repartida. Reactívelo desde «Mi equipo».`;
		}
	}

	const equipo = equipoDelRol(pool, carga, datos.rol, activo?.asesor_id);
	return {
		email,
		nombre: datos.nombre.trim(),
		rol: datos.rol,
		buckets: [...buckets],
		usuario: evaluado.usuario,
		bloqueo: evaluado.bloqueo ?? bloqueoCartera,
		asesorExistente,
		equipo,
		recomendacion: recomendarCarteraInicial(equipo),
		/** Capacidad por bucket del pool nuevo, tomada del equipo. */
		capacidades: capacidadSugeridaPorBucket(
			carga.porAsesor
				.filter((a) => equipo.some((m) => m.asesorId === a.asesor_id))
				.flatMap((a) =>
					a.porBucket.map((d) => ({
						bucket: d.bucket,
						capacidad: d.capacidad_base,
					})),
				),
			buckets,
		),
	};
}

/** Paso 1: el usuario del CRM (rol Cobros), creado, vinculado o habilitado. */
async function asegurarUsuarioCobros(
	usuario: UsuarioAlta,
	nombre: string,
	email: string,
): Promise<{ userId: string; accion: "creado" | "existente" | "reactivado" }> {
	if (usuario.estado === "existente") {
		return { userId: usuario.userId, accion: "existente" };
	}
	if (usuario.estado === "reactivar") {
		await db
			.update(user)
			.set({
				banned: false,
				banReason: null,
				banExpires: null,
				updatedAt: new Date(),
			})
			.where(and(eq(user.id, usuario.userId), eq(user.role, ROLES.COBROS)));
		return { userId: usuario.userId, accion: "reactivado" };
	}
	try {
		// Sin contraseña (better-auth lo permite): entra con su cuenta de Google
		// del dominio, que se vincula sola por el correo. Llamado desde el
		// servidor, sin cabeceras: el permiso lo decide este procedimiento.
		const r = await auth.api.createUser({
			body: { name: nombre, email, role: ROLES.COBROS },
		});
		if (r?.user?.id) return { userId: r.user.id, accion: "creado" };
	} catch (error) {
		console.warn("[alta-asesor] createUser:", error);
	}
	// Otra llamada pudo crearlo en paralelo (doble clic): si ya está, se sigue.
	const u = await usuarioPorCorreo(email);
	if (u?.role === ROLES.COBROS && !u.banned) {
		return { userId: u.id, accion: "existente" };
	}
	throw new ORPCError("INTERNAL_SERVER_ERROR", {
		message:
			"No se pudo crear el usuario del CRM del asesor. Intente de nuevo; no se creó nada en cartera.",
	});
}

/** Créditos de un asesor en esos buckets (`/buckets/creditos`, por páginas). */
async function creditosDelAsesor(asesorId: number, buckets: readonly number[]) {
	const creditos: { creditoId: number; bucket: number }[] = [];
	for (let page = 1; page <= 10; page++) {
		const r = await carteraBackClient.getCreditosPorBucket({
			asesor_id: asesorId,
			perPage: 500,
			page,
		});
		for (const fila of r.data) {
			const bucket = fila.bucket?.numero;
			if (
				fila.creditos?.asesor_id === asesorId &&
				typeof bucket === "number" &&
				buckets.includes(bucket)
			) {
				creditos.push({ creditoId: fila.creditos.credito_id, bucket });
			}
		}
		if (page >= (r.totalPages ?? 1)) break;
	}
	return creditos;
}

/** Ids de los créditos que cartera rechazó en un lote (400 con `errores`). */
function creditosRechazados(error: unknown): number[] {
	if (!(error instanceof CarteraBackHttpError) || error.status !== 400)
		return [];
	const errores = (error.payload?.errores ?? []) as unknown[];
	return errores
		.map((e) => Number((e as { credito_id?: unknown })?.credito_id))
		.filter((id) => Number.isInteger(id) && id > 0);
}

/**
 * Paso 3: lleva al asesor a `pedidos` créditos tomándolos de los asesores de su
 * nivel con más carga. Lo que ya tiene cuenta (un intento anterior o el motor):
 * solo se mueve lo que falta, así que repetirlo no duplica.
 */
async function asignarCarteraInicial(params: {
	asesorId: number;
	nombre: string;
	rol: RolAsesor;
	pedidos: number;
	actorEmail: string;
}) {
	const buckets = BUCKETS_POR_ROL[params.rol];
	const [pool, carga] = await Promise.all([
		carteraBackClient.getPoolPorAsesor({ useCache: false }),
		carteraBackClient.getCargaPorAsesorBucket({}),
	]);
	const yaTiene = cargaEnBuckets(carga, params.asesorId, buckets);
	const faltan = Math.max(
		0,
		Math.min(params.pedidos, MAX_CARTERA_INICIAL) - yaTiene,
	);
	if (faltan === 0) return { asignados: yaTiene, movidos: 0 };

	const plan = planCarteraInicial(
		equipoDelRol(pool, carga, params.rol, params.asesorId),
		faltan,
	);
	const porDonante = await Promise.all(
		plan.donantes.map(async (d) => ({
			donante: d,
			creditos: await creditosDelAsesor(d.asesorId, buckets),
		})),
	);
	const elegir = (excluir: ReadonlySet<number>) =>
		porDonante.flatMap(({ donante, creditos }) =>
			elegirCreditosDonante(creditos, donante.quitar, excluir),
		);
	let ids = elegir(new Set());
	if (ids.length === 0) return { asignados: yaTiene, movidos: 0 };

	const motivo = `Cartera inicial de ${params.nombre} (alta de asesor)`;
	const lote = (creditoIds: number[]) =>
		carteraBackClient.reasignarAsesorLote({
			credito_ids: creditoIds,
			asesor_nuevo_id: params.asesorId,
			motivo,
			usuario_email: params.actorEmail,
		});
	let resultado: Awaited<ReturnType<typeof lote>>;
	try {
		resultado = await lote(ids);
	} catch (error) {
		// Un crédito que cambió de bucket entre la lectura y el lote hace fallar
		// todo el lote: se reintenta UNA vez sin los rechazados.
		const rechazados = new Set(creditosRechazados(error));
		ids = ids.filter((id) => !rechazados.has(id));
		if (rechazados.size === 0 || ids.length === 0) throw error;
		resultado = await lote(ids);
	}
	try {
		// El acceso sigue a cartera: los avisos de «llamar al cliente» pasan al nuevo.
		await reconciliarAvisosLlamarCliente();
	} catch (error) {
		console.warn("[alta-asesor] avisos de llamadas:", error);
	}
	return {
		asignados: yaTiene + resultado.reasignados.length,
		movidos: resultado.reasignados.length,
	};
}

export async function crearAsesorCobros(
	datos: DatosAlta & { supervisorId?: string; creditos: number },
	actor: ActorEquipo,
) {
	const previa = await previsualizarAltaAsesor(datos, actor);
	if (previa.bloqueo || !previa.usuario) {
		throw new ORPCError("CONFLICT", {
			message: previa.bloqueo ?? "No se puede dar de alta a este asesor.",
		});
	}
	let supervisorEmail: string | undefined;
	if (datos.supervisorId) {
		const supervisor = (await listarSupervisoresCobros()).find(
			(s) => s.userId === datos.supervisorId,
		);
		if (!supervisor) {
			throw new ORPCError("BAD_REQUEST", {
				message: "Seleccione un supervisor de cobros habilitado.",
			});
		}
		supervisorEmail = normalizarCorreo(supervisor.email);
	}

	// 1. Asesor y pool en cartera. Va primero porque es lo que puede rechazar el
	// alta (p. ej. un asesor activo con el pool pausado, que la previsualización
	// del CRM no ve): así un rechazo no deja un usuario de Cobros sin cartera.
	// Si después falla el usuario del CRM, repetir el alta retoma: cartera
	// responde «existente» y no duplica nada.
	let alta: Awaited<ReturnType<typeof carteraBackClient.altaAsesorCobros>>;
	try {
		alta = await carteraBackClient.altaAsesorCobros({
			nombre: previa.nombre,
			email: previa.email,
			buckets: previa.buckets,
			capacidades: previa.capacidades,
			supervisorEmail,
			actorEmail: actor.email,
		});
	} catch (error) {
		traducirErrorCartera(error, "");
	}

	// 2. Usuario del CRM.
	let usuario: Awaited<ReturnType<typeof asegurarUsuarioCobros>>;
	try {
		usuario = await asegurarUsuarioCobros(
			previa.usuario,
			previa.nombre,
			previa.email,
		);
	} catch (error) {
		if (error instanceof ORPCError) {
			throw new ORPCError(error.code, {
				message: `El asesor quedó registrado en cartera, pero no se pudo preparar su usuario del CRM: ${error.message} Vuelva a intentar el alta: retoma donde quedó.`,
			});
		}
		throw error;
	}

	// 3. Cartera inicial.
	try {
		const inicial = await asignarCarteraInicial({
			asesorId: alta.asesor_id,
			nombre: previa.nombre,
			rol: datos.rol,
			pedidos: datos.creditos,
			actorEmail: actor.email,
		});
		return {
			asesorId: alta.asesor_id,
			nombre: previa.nombre,
			rol: datos.rol,
			usuario: usuario.accion,
			cartera: alta.accion,
			asignados: inicial.asignados,
			movidos: inicial.movidos,
		};
	} catch (error) {
		traducirErrorCartera(
			error,
			"El asesor quedó creado con su pool, pero no se pudo asignar su cartera inicial. Vuelva a intentarlo (no se duplica): ",
		);
	}
}

/* ── Baja ──────────────────────────────────────────────────────────────── */

export type DatosBaja = {
	asesorId: number;
	motivo: MotivoBaja;
	/** YYYY-MM-DD. */
	ultimoDia: string;
	detalle?: string;
};

/** No se da de baja a quien está ausente o participa en una cobertura vigente. */
async function validarSinAusenciaNiCobertura(
	asesorId: number,
	userId: string | null,
) {
	const [ausente] = await db
		.select({ id: ausenciasAsesorCobros.id })
		.from(ausenciasAsesorCobros)
		.where(
			and(
				eq(ausenciasAsesorCobros.asesorId, asesorId),
				eq(ausenciasAsesorCobros.estado, "vigente"),
			),
		)
		.limit(1);
	if (ausente) {
		throw new ORPCError("CONFLICT", {
			message:
				"El asesor está ausente con su cartera repartida. Reactívelo antes de darlo de baja.",
		});
	}
	if (!userId) return;
	const [cobertura] = await db
		.select({ id: coberturasAgendaCobros.id })
		.from(coberturasAgendaCobros)
		.where(
			and(
				or(
					eq(coberturasAgendaCobros.titularId, userId),
					eq(coberturasAgendaCobros.suplenteId, userId),
				),
				isNull(coberturasAgendaCobros.canceladaEn),
				gte(coberturasAgendaCobros.hasta, toDateStrGT(new Date())),
			),
		)
		.limit(1);
	if (cobertura) {
		throw new ORPCError("CONFLICT", {
			message:
				"El asesor tiene una cobertura vigente (como titular o suplente). Cancélela antes de darlo de baja.",
		});
	}
}

async function asesorYUsuario(asesorId: number) {
	const [pool, usuarios] = await Promise.all([
		carteraBackClient.getPoolPorAsesor({ useCache: false }),
		db
			.select({
				id: user.id,
				name: user.name,
				email: user.email,
				role: user.role,
			})
			.from(user),
	]);
	const asesor = pool.find((a) => a.asesor_id === asesorId);
	if (!asesor) {
		throw new ORPCError("NOT_FOUND", {
			message: "El asesor no está en el catálogo de cartera.",
		});
	}
	const correo = asesor.email_cash_in?.trim().toLowerCase();
	const crm = correo
		? usuarios.find((u) => u.email.trim().toLowerCase() === correo)
		: undefined;
	return { pool, asesor, crm: crm ?? null };
}

/**
 * «Redistribuir cartera»: el reparto que propone cartera (por capacidad, entre
 * el equipo de los buckets del asesor), sin tocar nada. Vale 10 minutos.
 */
export async function previsualizarBajaAsesor(
	datos: DatosBaja & { responsableEspecialesId?: number },
	actor: ActorEquipo,
) {
	const [{ pool, asesor, crm }, carga] = await Promise.all([
		asesorYUsuario(datos.asesorId),
		carteraBackClient.getCargaPorAsesorBucket({}),
	]);
	if (asesor.activo === false) {
		throw new ORPCError("CONFLICT", {
			message: `${asesor.nombre} ya está dado de baja.`,
		});
	}
	await validarSinAusenciaNiCobertura(datos.asesorId, crm?.id ?? null);

	// Quién puede quedarse con las cuentas fuera de cobro: un asesor activo y en
	// el pool (cartera lo exige), distinto del que se va.
	const candidatos = pool
		.filter(
			(a) =>
				a.activo !== false &&
				a.buckets.length > 0 &&
				a.asesor_id !== datos.asesorId,
		)
		.map((a) => ({
			asesorId: a.asesor_id,
			nombre: a.nombre,
			nivel: nivelPorBuckets(a.buckets),
			carga: cargaEnBuckets(carga, a.asesor_id),
		}));
	if (candidatos.length === 0) {
		throw new ORPCError("CONFLICT", {
			message:
				"No hay otro asesor activo en el pool que pueda recibir su cartera.",
		});
	}
	const nivel = nivelPorBuckets(asesor.buckets);
	if (
		datos.responsableEspecialesId !== undefined &&
		!candidatos.some((c) => c.asesorId === datos.responsableEspecialesId)
	) {
		throw new ORPCError("BAD_REQUEST", {
			message:
				"El responsable de las cuentas fuera de cobro debe ser otro asesor activo del pool.",
		});
	}
	const responsable =
		datos.responsableEspecialesId ??
		sugerirResponsableEspeciales(candidatos, nivel);

	const motivo = motivoDeLaBaja(datos);
	try {
		const preview = await carteraBackClient.previsualizarTrasladoCartera({
			asesorOrigenId: datos.asesorId,
			modo: "redistribucion",
			motivo,
			// Igual que la ausencia (M5): reparte por utilización, no por conteo.
			ponderarPorCapacidad: true,
			pausarPoolOrigen: true,
			desactivarOrigen: true,
			...(responsable ? { asesorDestinoEspecialId: responsable } : {}),
			actorEmail: actor.email,
		});
		const resumen = resumenRedistribucion(preview, datos.asesorId);
		return {
			previewId: preview.previewId,
			venceEn: preview.venceEn,
			motivo,
			nombre: asesor.nombre,
			nivel,
			resumen,
			responsableEspeciales:
				resumen.especiales.cantidad > 0
					? (candidatos.find(
							(c) => c.asesorId === resumen.especiales.responsableId,
						) ?? null)
					: null,
			candidatosEspeciales: candidatos
				.map(({ asesorId, nombre }) => ({ asesorId, nombre }))
				.sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
		};
	} catch (error) {
		traducirErrorCartera(error);
	}
}

/**
 * «Confirmar baja y redistribución»: reparte y desactiva en cartera (una sola
 * transacción) y suspende su usuario del CRM. `id` es la clave de idempotencia:
 * repetir la misma confirmación no repite el reparto.
 */
export async function confirmarBajaAsesor(
	datos: DatosBaja & { id: string; previewId: string },
	actor: ActorEquipo,
) {
	const { asesor, crm } = await asesorYUsuario(datos.asesorId);
	// En un reintento el asesor ya está desactivado: no se le pueden haber
	// creado ausencias ni coberturas nuevas, la validación no estorba.
	await validarSinAusenciaNiCobertura(datos.asesorId, crm?.id ?? null);
	const motivo = motivoDeLaBaja(datos);

	let resultado: Awaited<
		ReturnType<typeof carteraBackClient.confirmarTrasladoCartera>
	>;
	try {
		resultado = await carteraBackClient.confirmarTrasladoCartera({
			previewId: datos.previewId,
			idempotencyKey: datos.id,
			actorEmail: actor.email,
			asesorOrigenId: datos.asesorId,
			pausarPoolOrigen: true,
			desactivarOrigen: true,
			motivo,
		});
	} catch (error) {
		traducirErrorCartera(error);
	}
	try {
		await reconciliarAvisosLlamarCliente();
	} catch (error) {
		console.warn("[baja-asesor] avisos de llamadas:", error);
	}
	// Un cartera-back anterior a la baja descarta `desactivarOrigen` sin avisar:
	// repartiría y pausaría el pool pero dejaría al asesor activo. En ese caso no
	// se suspende su acceso y se dice qué pasó.
	if (!resultado.desactivado) {
		throw new ORPCError("CONFLICT", {
			message: `Se repartieron ${resultado.cuentas} créditos y el asesor salió de su pool, pero cartera no lo desactivó (su versión no admite la baja). Su usuario del CRM sigue activo; avise a sistemas antes de reintentar.`,
		});
	}

	// Su usuario del CRM: suspendido y sin sesiones abiertas. Solo un usuario de
	// cobros (a un supervisor o administrador que también sea asesor de cartera
	// no se le quita el acceso desde aquí).
	let usuarioSuspendido = false;
	if (crm && crm.role === ROLES.COBROS && crm.id !== actor.userId) {
		try {
			await db.transaction(async (tx) => {
				await tx
					.update(user)
					.set({ banned: true, banReason: motivo, updatedAt: new Date() })
					.where(and(eq(user.id, crm.id), eq(user.role, ROLES.COBROS)));
				await tx.delete(session).where(eq(session.userId, crm.id));
			});
			usuarioSuspendido = true;
		} catch (error) {
			console.error("[baja-asesor] suspender usuario:", error);
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message:
					"La cartera ya se repartió y el asesor quedó desactivado en cartera, pero no se pudo suspender su usuario del CRM. Vuelva a confirmar: el reparto no se repite.",
			});
		}
	}
	return {
		operacionId: resultado.operacionId,
		cuentas: resultado.cuentas,
		nombre: asesor.nombre,
		usuarioSuspendido,
		/** El correo no tenía usuario de cobros en el CRM (nada que suspender). */
		sinUsuarioCobros: !crm || crm.role !== ROLES.COBROS,
	};
}
