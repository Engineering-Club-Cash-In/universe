import { eq } from "drizzle-orm";
import { db } from "../../db";
import { user } from "../../db/schema/auth";
import { notifications } from "../../db/schema/notifications";

/**
 * Notifica a TODOS los admin que se abrió una alerta de la integración GPS
 * (CB-121). No es una notificación de cobros (no lleva cobrosTipo ni
 * relatedEntity: la alerta es de la integración, no de un caso puntual), así
 * que no reutiliza filasNotificacionCobros de cobros-notif-helpers.ts —ese
 * helper es específico del dominio de cobros (asesor + cobros_supervisor).
 *
 * La dedup real es el índice único parcial de gps_integracion_alertas
 * (una fila abierta por tipo+errorCode); esta función se llama solo la
 * primera vez que una alerta se abre, así que no necesita su propia dedup.
 */
export async function insertarNotificacionAdminGps(params: {
	createdBy: string;
	titulo: string;
	descripcion: string;
}): Promise<void> {
	const admins = await db
		.select({ id: user.id })
		.from(user)
		.where(eq(user.role, "admin"));

	if (admins.length === 0) return;

	await db.insert(notifications).values(
		admins.map((admin) => ({
			titulo: params.titulo,
			descripcion: params.descripcion,
			type: "system" as const,
			createdBy: params.createdBy,
			createdByRole: "admin" as const,
			assignedToRole: "admin" as const,
			assignedTo: admin.id,
			redirectPage: "admin_gps" as const,
		})),
	);
}
