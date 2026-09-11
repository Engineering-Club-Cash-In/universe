// CB-033 — Notificaciones de la aprobación de convenios.
//
// Cobertura: SOLO decisiones tomadas desde el CRM. Una decisión desde
// carteraFront queda auditada en cartera (convenio_decisiones) pero no pasa
// por acá — no existe canal de cartera hacia el CRM, y agregar uno (job de
// reconciliación o webhook) fue decisión explícita de negocio: no se hace en
// CB-033. Ver docs/features/cobros-02/06-ficha-360.md §3.5.
//
// Entrega no garantizada: el aviso se inserta DESPUÉS de que cartera
// commiteó la decisión. Si el CRM cae en esa ventana, o el INSERT falla, la
// decisión queda firme y el aviso nunca existe — el índice único evita
// duplicados, no garantiza entrega. Por eso todo acá es best-effort: un
// fallo de notificación NUNCA se reporta como fallo de la decisión (mismo
// criterio que el etiquetado del caso en crearConvenioDesdeFicha).

import { sql } from "drizzle-orm";
import { db } from "../db";
import { notifications } from "../db/schema/notifications";
import {
	obtenerSupervisoresCobros,
	resolverUsuarioSistemaCobros,
} from "./cobros-notif-helpers";

const Q = (n: number) =>
	`Q${n.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Al crear un convenio: avisa a TODOS los cobros_supervisor. Se llama al
 * final de `crearConvenioDesdeFicha`, en su propio try/catch best-effort —
 * este helper no lanza por diseño (ver el catch interno).
 */
export async function notificarConvenioPendienteAprobacion(params: {
	casoCobroId: string;
	clienteNombre?: string;
	montoTotal: number;
	creadoPorUserId: string;
}): Promise<void> {
	try {
		const supervisores = await obtenerSupervisoresCobros();
		if (supervisores.length === 0) return;

		const usuarioSistema =
			(await resolverUsuarioSistemaCobros()) ?? params.creadoPorUserId;
		const titulo = "Convenio pendiente de aprobación";
		const descripcion = `${params.clienteNombre ?? "Un cliente"} tiene un convenio de pago por ${Q(params.montoTotal)} esperando tu aprobación.`;

		await db.insert(notifications).values(
			supervisores.map((supervisorId) => ({
				titulo,
				descripcion,
				type: "action_required" as const,
				status: "pending" as const,
				cobrosTipo: "convenio_pendiente_aprobacion" as const,
				relatedEntityType: "collection_case" as const,
				relatedEntityId: params.casoCobroId,
				redirectPage: "cobros_detail" as const,
				createdBy: usuarioSistema,
				createdByRole: "cobros_supervisor" as const,
				assignedToRole: "cobros_supervisor" as const,
				assignedTo: supervisorId,
			})),
		);
	} catch (error) {
		console.warn(
			"[notificarConvenioPendienteAprobacion] No se pudo notificar (best-effort):",
			error instanceof Error ? error.message : error,
		);
	}
}

/**
 * Al resolver (aprobar/rechazar): avisa al asesor. `decisionId` es el de
 * cartera (`convenio_decisiones.decision_id`) — en una respuesta idempotente
 * es el de la decisión ORIGINAL, así que un reintento tras un timeout no
 * genera un aviso nuevo: el INSERT con ON CONFLICT lo descarta.
 */
export async function notificarConvenioResuelto(params: {
	casoCobroId: string;
	asesorUserId: string | null;
	decisionId: number;
	decision: "aprobado" | "rechazado";
	motivo?: string | null;
	creadoPorUserId: string;
}): Promise<void> {
	if (!params.asesorUserId) return; // sin asesor enlazado por correo, no hay a quién avisar
	try {
		const titulo =
			params.decision === "aprobado"
				? "Convenio aprobado"
				: "Convenio rechazado";
		const descripcion =
			params.decision === "aprobado"
				? "El supervisor aprobó el convenio de pago."
				: `El supervisor rechazó el convenio de pago. Motivo: ${params.motivo ?? "sin especificar"}.`;

		// La dedup es la restricción, no una consulta previa: un SELECT antes
		// del INSERT no protege bajo concurrencia (dos reintentos simultáneos
		// lo pasan ambos). Se confía en el ON CONFLICT del índice único
		// uq_notifications_convenio_decision — Drizzle no expone
		// onConflictDoNothing con `where` parcial de forma portable acá, así
		// que se usa SQL crudo para el ON CONFLICT calificado al índice.
		await db.execute(sql`
			INSERT INTO notifications (
				id, titulo, descripcion, status, type, created_by, created_by_role,
				assigned_to_role, assigned_to, related_entity_type, related_entity_id,
				redirect_page, cobros_tipo, convenio_decision_id, created_at, updated_at
			) VALUES (
				gen_random_uuid(), ${titulo}, ${descripcion}, 'pending', 'aviso',
				${params.creadoPorUserId}, 'cobros_supervisor', 'cobros', ${params.asesorUserId},
				'collection_case', ${params.casoCobroId}, 'cobros_detail', 'convenio_resuelto',
				${params.decisionId}, now(), now()
			)
			ON CONFLICT (convenio_decision_id, assigned_to) WHERE convenio_decision_id IS NOT NULL
			DO NOTHING
		`);
	} catch (error) {
		console.warn(
			"[notificarConvenioResuelto] No se pudo notificar (best-effort):",
			error instanceof Error ? error.message : error,
		);
	}
}
