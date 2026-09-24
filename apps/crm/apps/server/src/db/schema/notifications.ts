import { relations, sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { user, userRoleEnum } from "./auth";

// Enums
export const notificationStatusEnum = pgEnum("notification_status", [
	"pending",
	"read",
	"in_progress",
	"resolved",
	"dismissed",
]);

export const notificationTypeEnum = pgEnum("notification_type", [
	"aviso",
	"action_upload_files",
	"action_required",
	"reminder",
	"system",
	"pay_investors",
]);

export const notificationEntityTypeEnum = pgEnum("notification_entity_type", [
	"lead",
	"opportunity",
	"vehicle",
	"contract",
	"collection_case",
	"opportunity_client",
]);

export const notificationRedirectPageEnum = pgEnum(
	"notification_redirect_page",
	[
		"opportunity_details",
		"client_details",
		"vehicle_details",
		"contract_details",
		"analysis_details",
		"analysis_50_details",
		"analysis_90_details",
		"pay_investors",
		"cobros_detail",
		"client_details_disbursement",
		// CB-121: alerta de falla/degradación de la integración GPS/Wialon,
		// dirigida a admin. No lleva relatedEntityId (no es una entidad del
		// CRM), igual que pay_investors.
		"admin_gps",
	],
);

// COBROS-02: subtipo específico de las notificaciones del módulo de cobros.
// Vive en su propia columna `cobros_tipo` (NO en `type`, que es general del CRM)
// y solo lo setean los jobs de cobros; toda otra notificación lo deja null. La
// web lo usa para pintar cada tarjeta de un color distinto.
export const cobrosNotifTipoEnum = pgEnum("cobros_notif_tipo", [
	"promesa_incumplida",
	"cliente_subido",
	"sin_contacto_3d",
	// CB-029: recordatorio proactivo al asesor de una promesa que está por vencer
	// (se dispara el día de su fecha_alerta, default D-1). Solo al asesor.
	"promesa_por_vencer",
	// CB-033: convenio recién creado, pendiente de que un cobros_supervisor
	// lo apruebe o rechace. Va a TODOS los cobros_supervisor.
	"convenio_pendiente_aprobacion",
	// CB-033: la decisión (aprobado/rechazado) de un convenio, de vuelta al
	// asesor que lo creó.
	"convenio_resuelto",
	// COBROS-02 Fase 1: el convenio tiene una cuota vencida e impaga. Va al
	// asesor dueño del crédito Y a los cobros_supervisor (decisión 7 del plan
	// 08): incumplir un convenio ya negociado es una señal de escalamiento, no
	// solo una tarea más del asesor.
	"convenio_incumplido",
	// COBROS-02 Fase 1.b: un cliente escribió en el bot de WhatsApp. Va SOLO al
	// asesor dueño del crédito (decisión 16 del plan 08) y se deduplica por
	// referencia de conversación (`sesion_id`), no por mensaje ni por día.
	"bot_cliente_escribio",
	// COBROS-02: el cliente pasó a MODO AGENTE en el bot (pidió un humano).
	// Mismo destinatario que `bot_cliente_escribio` —el asesor dueño— y apunta
	// a esa alerta por `notificacion_origen_id`: son la misma conversación, en
	// dos momentos. Lo crea `POST /api/bot/cobros/conversacion/modo-agente`.
	"bot_modo_agente",
	// CB-119: evento de Wialon (desconexión de energía, ignición/movimiento,
	// GPS sin reportar) detectado por el job de polling en un vehículo con
	// caso de cobro activo. Va al asesor dueño del caso y, para
	// desconexión/sin-reportar (posible manipulación), también a los
	// cobros_supervisor. Dedup por episodio en
	// `uq_notifications_cobros_dedup` (ventana por tipo, ver
	// services/wialon/gps-eventos.ts).
	"gps_evento",
]);

// Notifications table
export const notifications = pgTable(
	"notifications",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		titulo: text("titulo").notNull(),
		descripcion: text("descripcion"),

		status: notificationStatusEnum("status").notNull().default("pending"),
		type: notificationTypeEnum("type").notNull(),

		// Creador
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		createdByRole: userRoleEnum("created_by_role").notNull(),

		// Asignación
		assignedToRole: userRoleEnum("assigned_to_role").notNull(),
		assignedTo: text("assigned_to").references(() => user.id),

		// Entidad relacionada (polimórfica)
		relatedEntityType: notificationEntityTypeEnum("related_entity_type"),
		relatedEntityId: uuid("related_entity_id"),

		// Redirect URL
		redirectPage: notificationRedirectPageEnum("redirect_page"),

		// COBROS-02: subtipo de cobros (null para el resto de notificaciones).
		cobrosTipo: cobrosNotifTipoEnum("cobros_tipo"),

		// CB-033: id numérico de `convenio_decisiones` en cartera-back (SIN FK
		// — otra DB). Es la clave de dedup: una respuesta idempotente de
		// cartera trae el decision_id de la decisión ORIGINAL, así que un
		// reintento tras un timeout no debe generar un aviso nuevo — ver el
		// índice único de abajo. Null para el resto de notificaciones y para
		// el aviso "convenio_pendiente_aprobacion" (todavía no hay decisión).
		convenioDecisionId: integer("convenio_decision_id"),

		// COBROS-02 Fase 1: llave de deduplicación del EPISODIO que originó la
		// alerta — "este convenio con esta cuota vencida", "esta conversación
		// del bot". Los jobs viejos deduplican por ventana de 24 h, que no
		// sirve para un episodio que dura días: repetiría el aviso cada
		// mañana. El formato lo define cada job (ver el índice único parcial
		// `uq_notifications_cobros_dedup`, migración 0054). Null para todo lo
		// que no lo use.
		cobrosDedupKey: text("cobros_dedup_key"),

		// CB-033: id del convenio en cartera-back (SIN FK — otra DB, y el
		// rechazo borra la fila). Lo lleva el aviso
		// "convenio_pendiente_aprobacion", que nace SIN decisión y por eso no
		// puede identificarse con `convenioDecisionId`. Es lo que permite
		// cerrar al decidir SOLO los avisos de ESE convenio: un crédito puede
		// tener un convenio nuevo después de que el anterior se rechazó, y
		// ambos comparten caso, así que un reintento idempotente del rechazo
		// viejo (que devuelve el convenio_id original) cerraría también los
		// avisos del convenio nuevo si el filtro fuera solo por caso.
		convenioId: integer("convenio_id"),

		// COBROS-02: la notificación de la que esta es continuación. Hoy la usa
		// solo `bot_modo_agente`, que apunta al `bot_cliente_escribio` de la
		// misma conversación y crédito — así el asesor ve un solo hilo
		// ("escribió" → "pidió un agente") y no dos alertas sueltas. Null si no
		// hubo aviso inicial (p. ej. el asesor no estaba vinculado todavía).
		// SET NULL: descartar o purgar la inicial no puede borrar la segunda.
		notificacionOrigenId: uuid("notificacion_origen_id").references(
			(): AnyPgColumn => notifications.id,
			{ onDelete: "set null" },
		),

		// Timestamps de estado
		readAt: timestamp("read_at"),
		resolvedAt: timestamp("resolved_at"),

		// Timestamps
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(table) => [
		index("idx_notifications_dedup").on(
			table.relatedEntityId,
			table.relatedEntityType,
			table.titulo,
			table.createdAt,
		),
		// CB-033 — la dedup es esta restricción, no una consulta previa a un
		// INSERT: un SELECT antes del INSERT no protege bajo concurrencia (dos
		// reintentos simultáneos lo pasan ambos e insertan dos avisos). La
		// clave incluye `assigned_to` porque una misma decisión puede
		// notificar a varias personas (todos los cobros_supervisor) — una
		// fila por (decisión, destinatario), nunca dos. Parcial: solo aplica
		// cuando hay decisión (el resto de notificaciones no participa).
		uniqueIndex("uq_notifications_convenio_decision")
			.on(table.convenioDecisionId, table.assignedTo)
			.where(sql`${table.convenioDecisionId} IS NOT NULL`),
		// CB-033 — lo usan el cierre de pendientes y la reconciliación, que
		// filtran por `convenio_id`. Va DECLARADO acá y no solo en la
		// migración: `db:push` compara la base contra este schema, así que un
		// índice creado solo por SQL se ve como sobrante y lo dropearía.
		index("idx_notifications_convenio_pendiente")
			.on(table.convenioId)
			.where(sql`${table.convenioId} IS NOT NULL`),
		// COBROS-02 Fase 1 — la dedup POR EPISODIO. Va declarado acá y no solo
		// en la migración 0054 por la misma razón que el de arriba: `db:push`
		// compara la base contra este schema, así que un índice creado solo por
		// SQL se ve como sobrante y lo dropearía. Y sin el índice,
		// `onConflictDoNothing()` no tiene nada que suprimir: el job de
		// convenios incumplidos volvería a crear el mismo aviso cada mañana al
		// asesor y a cada supervisor, y dos peticiones simultáneas del bot
		// duplicarían la alerta de una conversación (review de Codex, P2).
		//
		// `assigned_to` es parte de la llave porque la misma alerta va a varias
		// personas: una fila por (tipo, episodio, destinatario), nunca dos.
		uniqueIndex("uq_notifications_cobros_dedup")
			.on(table.cobrosTipo, table.cobrosDedupKey, table.assignedTo)
			.where(sql`${table.cobrosDedupKey} IS NOT NULL`),
		// Declarado acá por lo mismo que los de arriba (migración 0056): sirve
		// para traer las continuaciones de una notificación.
		index("idx_notifications_origen")
			.on(table.notificacionOrigenId)
			.where(sql`${table.notificacionOrigenId} IS NOT NULL`),
	],
);

// Notification Documents table
export const notificationDocuments = pgTable("notification_documents", {
	id: uuid("id").primaryKey().defaultRandom(),

	notificationId: uuid("notification_id")
		.notNull()
		.references(() => notifications.id, { onDelete: "cascade" }),

	// File information
	filename: text("filename").notNull(),
	originalName: text("original_name").notNull(),
	mimeType: text("mime_type").notNull(),
	size: integer("size").notNull(),
	filePath: text("file_path").notNull(),

	// Upload metadata
	uploadedBy: text("uploaded_by")
		.notNull()
		.references(() => user.id),
	uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
});

// Relations
export const notificationsRelations = relations(
	notifications,
	({ one, many }) => ({
		creator: one(user, {
			fields: [notifications.createdBy],
			references: [user.id],
			relationName: "notificationCreator",
		}),
		assignee: one(user, {
			fields: [notifications.assignedTo],
			references: [user.id],
			relationName: "notificationAssignee",
		}),
		documents: many(notificationDocuments),
	}),
);

export const notificationDocumentsRelations = relations(
	notificationDocuments,
	({ one }) => ({
		notification: one(notifications, {
			fields: [notificationDocuments.notificationId],
			references: [notifications.id],
		}),
		uploader: one(user, {
			fields: [notificationDocuments.uploadedBy],
			references: [user.id],
		}),
	}),
);

// Export types
export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

export type NotificationDocument = typeof notificationDocuments.$inferSelect;
export type NewNotificationDocument = typeof notificationDocuments.$inferInsert;
