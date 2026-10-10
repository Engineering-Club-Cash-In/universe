/**
 * COBROS-02 — Helpers compartidos por los jobs de alertas de cobros
 * (promesa incumplida, cliente subido, sin contacto 3 días hábiles).
 *
 * Resuelven los destinatarios de las notificaciones:
 *  - El ASESOR del crédito es el de cartera (`asesor_id`), enlazado a un usuario
 *    del CRM por correo (`asesores.email_cash_in` == `user.email`) — mismo
 *    puente que usa la Agenda. `construirMapaAsesorUsuario` arma ese mapa una
 *    sola vez por corrida, vía `getPoolPorAsesor` (única fuente con
 *    email_cash_in; /advisor expone platform_users.email y está desfasado).
 *  - El SUPERVISOR son TODOS los `user.role = 'cobros_supervisor'` (no existe
 *    mapeo asesor→supervisor; hoy son uno o dos).
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import { casosCobros } from "../db/schema/cobros";
import type { NewNotification } from "../db/schema/notifications";
import { carteraBackClient } from "./cartera-back-client";

export type CobrosNotifTipo =
	| "promesa_incumplida"
	| "cliente_subido"
	| "sin_contacto_3d"
	| "promesa_por_vencer"
	| "convenio_pendiente_aprobacion"
	| "convenio_resuelto"
	| "convenio_incumplido"
	| "bot_cliente_escribio"
	| "bot_modo_agente"
	| "gps_evento"
	| "inmovilizacion_pendiente_aprobacion"
	| "inmovilizacion_resuelta"
	| "inmovilizacion_llamar_cliente"
	| "inmovilizacion_ejecutar_pendiente"
	| "inmovilizacion_apagado_ejecutado"
	| "inmovilizacion_reactivacion_ejecutada"
	| "recuperacion_vehiculo"
	| "b3_llamada_supervisor"
	| "b3_llamada_vencida"
	| "visita_programada"
	| "recuperacion_pendiente_aprobacion"
	| "recuperacion_resuelta"
	| "rebaja_pendiente_aprobacion"
	| "rebaja_resuelta"
	| "juridico_pendiente_aprobacion"
	| "juridico_resuelto";

/**
 * Mapa `asesor_id (cartera) → user.id (CRM)`, cruzando el correo de cash-in del
 * asesor contra el correo de login del usuario del CRM. Asesores sin usuario
 * vinculado por correo simplemente no entran al mapa (su notificación se omite).
 */
export async function construirMapaAsesorUsuario(options?: {
	/**
	 * `false` para callers best-effort cuyo fallo ya se traga el caller (p.ej.
	 * resolver a quién notificar DESPUÉS de que un pago ya se aplicó) — no debe
	 * compartir contador de fallos con las operaciones de cartera-back que sí
	 * importan. Los jobs de alertas de cobros (que sí necesitan que esto sea
	 * confiable) mantienen el breaker normal por default.
	 */
	useCircuitBreaker?: boolean;
}): Promise<Map<number, string>> {
	// getPoolPorAsesor (email_cash_in), NO getAdvisors(): /advisor expone
	// `platform_users.email` vía LEFT JOIN, que está desactualizado o no matchea
	// para varios asesores (Diego Gomez, Samuel Gamboa, Caren Rivera) — con esa
	// fuente sus notificaciones de cobros nunca se creaban. email_cash_in sí es
	// el correo que coincide con el login del CRM.
	const asesores = (
		await carteraBackClient.getPoolPorAsesor({
			useCircuitBreaker: options?.useCircuitBreaker,
		})
	).filter((a) => Boolean(a.email_cash_in));
	if (asesores.length === 0) return new Map();

	// La tabla `user` es de staff (decenas): traerla entera y matchear en JS
	// evita problemas de case/collation de un IN con lower() en SQL.
	const usuarios = await db
		.select({ id: user.id, email: user.email })
		.from(user);
	const emailToUser = new Map(
		usuarios.map((u) => [u.email.trim().toLowerCase(), u.id]),
	);

	const mapa = new Map<number, string>();
	for (const a of asesores) {
		const uid = emailToUser.get(
			(a.email_cash_in as string).trim().toLowerCase(),
		);
		if (uid) mapa.set(a.asesor_id, uid);
	}
	return mapa;
}

/** user.id de TODOS los supervisores de cobros (destinatarios del escalamiento). */
export async function obtenerSupervisoresCobros(): Promise<string[]> {
	const rows = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.role, "cobros_supervisor"));
	return rows.map((r) => r.id);
}

/**
 * Usuario "sistema" para el FK `created_by` de notificaciones automáticas:
 * PREMORA_SYSTEM_USER_ID si está seteado, si no el primer admin. Mismo criterio
 * que premora (resolverUsuarioSistema) — no hay humano detrás del job.
 */
export async function resolverUsuarioSistemaCobros(): Promise<string | null> {
	const fromEnv = process.env.PREMORA_SYSTEM_USER_ID?.trim();
	if (fromEnv) return fromEnv;
	const [admin] = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.role, "admin"))
		.limit(1);
	return admin?.id ?? null;
}

/**
 * Construye las filas de notificación (asesor + supervisores) para una alerta
 * de cobros. NO inserta ni deduplica — cada job hace su propio dedup antes de
 * insertar (la ventana difiere: 24h para las diarias, "desde la subida" para
 * sin_contacto_3d). Devuelve [] si no hay a quién notificar.
 */
export function filasNotificacionCobros(params: {
	casoId: string;
	cobrosTipo: CobrosNotifTipo;
	titulo: string;
	descripcion: string;
	/**
	 * Descripción alterna para las filas de SUPERVISOR — típicamente incluye el
	 * nombre del asesor que no gestionó ("quién no lo tomó"). Si se omite, los
	 * supervisores reciben la misma `descripcion` que el asesor.
	 */
	descripcionSupervisor?: string;
	/** user.id del asesor (null si no se pudo enlazar por correo). */
	asesorUserId: string | null;
	/** Supervisores a los que escalar; [] cuando la alerta es solo del asesor. */
	supervisores: string[];
	/** FK created_by para las filas de supervisor (no dependen del asesor). */
	usuarioSistema: string;
	/**
	 * Llave del EPISODIO, para los jobs que deduplican por episodio y no por
	 * ventana de tiempo (`uq_notifications_cobros_dedup`, migración 0054). El
	 * caller debe insertar con `onConflictDoNothing` para que la restricción
	 * haga su trabajo en vez de reventar.
	 */
	dedupKey?: string;
	/** `type` de la notificación. Default `reminder`; las tareas usan `action_required`. */
	type?: "reminder" | "action_required";
	/** Plazo de la tarea (CB-035). Se omite en los avisos que no tienen vencimiento. */
	fechaVencimiento?: Date;
}): NewNotification[] {
	const base = {
		titulo: params.titulo,
		type: params.type ?? ("reminder" as const),
		status: "pending" as const,
		cobrosTipo: params.cobrosTipo,
		relatedEntityType: "collection_case" as const,
		relatedEntityId: params.casoId,
		redirectPage: "cobros_detail" as const,
		...(params.dedupKey ? { cobrosDedupKey: params.dedupKey } : {}),
		...(params.fechaVencimiento
			? { fechaVencimiento: params.fechaVencimiento }
			: {}),
	};

	const filas: NewNotification[] = [];
	if (params.asesorUserId) {
		filas.push({
			...base,
			descripcion: params.descripcion,
			createdBy: params.asesorUserId,
			createdByRole: "cobros",
			assignedToRole: "cobros",
			assignedTo: params.asesorUserId,
		});
	}
	const descSupervisor = params.descripcionSupervisor ?? params.descripcion;
	for (const supervisorId of params.supervisores) {
		filas.push({
			...base,
			descripcion: descSupervisor,
			createdBy: params.usuarioSistema,
			createdByRole: "cobros_supervisor",
			assignedToRole: "cobros_supervisor",
			assignedTo: supervisorId,
		});
	}
	return filas;
}

/** Mapa `numero_credito_sifco → caso.id` (solo casos activos). */
export async function mapearCasosPorSifco(
	sifcos: string[],
): Promise<Map<string, string>> {
	const unicos = [...new Set(sifcos.filter(Boolean))];
	if (unicos.length === 0) return new Map();
	const rows = await db
		.select({ id: casosCobros.id, sifco: casosCobros.numeroCreditoSifco })
		.from(casosCobros)
		.where(
			and(
				eq(casosCobros.activo, true),
				inArray(casosCobros.numeroCreditoSifco, unicos),
			),
		);
	const map = new Map<string, string>();
	for (const r of rows) if (r.sifco) map.set(r.sifco, r.id);
	return map;
}
