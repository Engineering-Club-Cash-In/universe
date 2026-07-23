/**
 * COBROS-02 — Helpers compartidos por los jobs de alertas de cobros
 * (promesa incumplida, cliente subido, sin contacto 3 días hábiles).
 *
 * Resuelven los destinatarios de las notificaciones:
 *  - El ASESOR del crédito es el de cartera (`asesor_id`), enlazado a un usuario
 *    del CRM por correo (`asesores.email_cash_in` == `user.email`) — mismo
 *    puente que usa la Agenda. `construirMapaAsesorUsuario` arma ese mapa una
 *    sola vez por corrida (getAdvisors va cacheado 5m en cartera-back).
 *  - El SUPERVISOR son TODOS los `user.role = 'cobros_supervisor'` (no existe
 *    mapeo asesor→supervisor; hoy son uno o dos).
 */

import { eq } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/schema/auth";
import type { NewNotification } from "../db/schema/notifications";
import { carteraBackClient } from "./cartera-back-client";

export type CobrosNotifTipo =
	| "promesa_incumplida"
	| "cliente_subido"
	| "sin_contacto_3d";

/**
 * Mapa `asesor_id (cartera) → user.id (CRM)`, cruzando el correo de cash-in del
 * asesor contra el correo de login del usuario del CRM. Asesores sin usuario
 * vinculado por correo simplemente no entran al mapa (su notificación se omite).
 */
export async function construirMapaAsesorUsuario(): Promise<
	Map<number, string>
> {
	const advisors = await carteraBackClient.getAdvisors({
		page: 1,
		perPage: 500,
	});
	const asesores = (advisors.data ?? []).filter((a) => Boolean(a.email));
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
		const uid = emailToUser.get(a.email.trim().toLowerCase());
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
	/** user.id del asesor (null si no se pudo enlazar por correo). */
	asesorUserId: string | null;
	/** Supervisores a los que escalar; [] cuando la alerta es solo del asesor. */
	supervisores: string[];
	/** FK created_by para las filas de supervisor (no dependen del asesor). */
	usuarioSistema: string;
}): NewNotification[] {
	const base = {
		titulo: params.titulo,
		descripcion: params.descripcion,
		type: "reminder" as const,
		status: "pending" as const,
		cobrosTipo: params.cobrosTipo,
		relatedEntityType: "collection_case" as const,
		relatedEntityId: params.casoId,
		redirectPage: "cobros_detail" as const,
	};

	const filas: NewNotification[] = [];
	if (params.asesorUserId) {
		filas.push({
			...base,
			createdBy: params.asesorUserId,
			createdByRole: "cobros",
			assignedToRole: "cobros",
			assignedTo: params.asesorUserId,
		});
	}
	for (const supervisorId of params.supervisores) {
		filas.push({
			...base,
			createdBy: params.usuarioSistema,
			createdByRole: "cobros_supervisor",
			assignedToRole: "cobros_supervisor",
			assignedTo: supervisorId,
		});
	}
	return filas;
}
