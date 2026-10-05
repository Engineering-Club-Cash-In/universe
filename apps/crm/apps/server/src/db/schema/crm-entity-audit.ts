import {
	boolean,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";

// Entidades que se auditan. Se agregan acá cuando el negocio pida otra.
export const crmAuditEntityTypeEnum = pgEnum("crm_audit_entity_type", [
	"lead",
	"opportunity",
	"vehicle",
]);

// Desde dónde vino la escritura. `crm` = un usuario logueado vía /rpc;
// el resto son flujos sin sesión (bot de WhatsApp, portal del cliente,
// formularios públicos) o procesos internos.
export const crmAuditSourceEnum = pgEnum("crm_audit_source", [
	"crm",
	"bot",
	"portal",
	"public",
	"system",
]);

// Bitácora de escrituras sobre leads, oportunidades y vehículos.
// Append-only: una fila por operación, con el body redactado y quién la hizo.
//
// Sin FKs a propósito: la auditoría tiene que sobrevivir a borrados de la
// entidad y nunca puede ser la causa de que falle la operación que registra
// (una FK rota dentro de una transacción abortaría todo el flujo).
export const crmEntityAudit = pgTable(
	"crm_entity_audit",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		entityType: crmAuditEntityTypeEnum("entity_type").notNull(),
		// Nullable: en un `create` que falló todavía no hay id.
		entityId: text("entity_id"),
		// create | update | delete | reassign | approve_* | stage_change | ...
		action: text("action").notNull(),
		// Ruta del procedure ORPC ("crm.updateOpportunity") o el nombre de la
		// función para escrituras fuera de /rpc.
		procedure: text("procedure"),
		performedBy: text("performed_by"),
		performedByRole: text("performed_by_role"),
		source: crmAuditSourceEnum("source").notNull().default("crm"),
		// Body de la operación ya pasado por `redactAuditInput`.
		input: jsonb("input"),
		ok: boolean("ok").notNull().default(true),
		errorCode: text("error_code"),
		durationMs: integer("duration_ms"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => [
		index("crm_entity_audit_entity_idx").on(
			table.entityType,
			table.entityId,
			table.createdAt.desc(),
		),
		index("crm_entity_audit_performed_by_idx").on(
			table.performedBy,
			table.createdAt.desc(),
		),
		index("crm_entity_audit_created_at_idx").on(table.createdAt.desc()),
	],
);

export type CrmEntityAudit = typeof crmEntityAudit.$inferSelect;
export type NewCrmEntityAudit = typeof crmEntityAudit.$inferInsert;
