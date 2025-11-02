/**
 * Cartera-Back Integration Schema
 * Tables for linking CRM data with cartera-back financial system
 */

import { boolean, decimal, integer, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { opportunities } from "./crm";
import { contratosFinanciamiento, casosCobros } from "./cobros";

// ============================================================================
// CARTERA-BACK REFERENCES
// ============================================================================

/**
 * Links CRM opportunities and contracts to cartera-back credits
 * This is the main reference table for the integration
 */
export const carteraBackReferences = pgTable("cartera_back_references", {
	id: uuid("id").primaryKey().defaultRandom(),

	// CRM references (optional - for historical tracking)
	opportunityId: uuid("opportunity_id").references(() => opportunities.id, { onDelete: "set null" }),
	contratoFinanciamientoId: uuid("contrato_financiamiento_id").references(() => contratosFinanciamiento.id, { onDelete: "set null" }),

	// Cartera-back references (required)
	carteraCreditoId: integer("cartera_credito_id").notNull(), // credito_id from cartera-back
	numeroCreditoSifco: varchar("numero_credito_sifco", { length: 40 }).notNull().unique(), // SIFCO external ID

	// Sync metadata
	syncedAt: timestamp("synced_at", { withTimezone: true }).defaultNow().notNull(),
	lastSyncStatus: text("last_sync_status"), // "success", "error", "pending"
	lastSyncError: text("last_sync_error"), // Error message if sync failed

	// Audit
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	createdBy: text("created_by").notNull(), // user ID who created the link
});

// ============================================================================
// PAGO REFERENCES
// ============================================================================

/**
 * Tracks payments registered from CRM to cartera-back
 * Links CRM collection cases to cartera-back payments
 */
export const pagoReferences = pgTable("pago_references", {
	id: uuid("id").primaryKey().defaultRandom(),

	// Cartera-back payment reference
	carteraPagoId: integer("cartera_pago_id").notNull().unique(), // pago_id from cartera-back
	numeroCreditoSifco: varchar("numero_credito_sifco", { length: 40 }).notNull(), // For quick lookups
	cuotaNumero: integer("cuota_numero").notNull(), // Which installment number

	// Payment details (cached for quick access)
	montoBoleta: decimal("monto_boleta", { precision: 12, scale: 2 }).notNull(),
	fechaPago: timestamp("fecha_pago", { withTimezone: true }).notNull(),

	// CRM references
	casoCobroId: uuid("caso_cobro_id").references(() => casosCobros.id, { onDelete: "set null" }), // Optional link to collection case

	// Registration metadata
	registradoPor: text("registrado_por").notNull(), // user ID who registered payment
	registradoEn: timestamp("registrado_en", { withTimezone: true }).defaultNow().notNull(),

	// Sync status
	syncStatus: text("sync_status").default("synced").notNull(), // "synced", "pending", "error"
	syncError: text("sync_error"), // Error message if sync failed
});

// ============================================================================
// SYNC LOG (for debugging and monitoring)
// ============================================================================

/**
 * Logs all sync operations between CRM and cartera-back
 * Useful for debugging and monitoring integration health
 */
export const carteraBackSyncLog = pgTable("cartera_back_sync_log", {
	id: uuid("id").primaryKey().defaultRandom(),

	// Sync operation details
	operation: text("operation").notNull(), // "create_credit", "create_payment", "update_credit", "sync_casos"
	entityType: text("entity_type").notNull(), // "credito", "pago", "usuario", "caso_cobros"
	entityId: text("entity_id").notNull(), // ID of the entity (could be UUID or numero_sifco)

	// Operation result
	status: text("status").notNull(), // "success", "error", "pending"
	errorMessage: text("error_message"),
	requestPayload: text("request_payload"), // JSON string of request sent to cartera-back
	responsePayload: text("response_payload"), // JSON string of response received

	// Timing
	startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
	completedAt: timestamp("completed_at", { withTimezone: true }),
	durationMs: integer("duration_ms"), // Duration in milliseconds

	// Context
	userId: text("user_id"), // User who triggered the operation
	source: text("source").default("crm").notNull(), // "crm", "sync_job", "webhook", "manual"
});

// ============================================================================
// FEATURE FLAGS
// ============================================================================

/**
 * Runtime feature flags for gradual rollout
 * Can be toggled without redeploying
 */
export const carteraBackFeatureFlags = pgTable("cartera_back_feature_flags", {
	id: uuid("id").primaryKey().defaultRandom(),

	// Flag details
	flagName: varchar("flag_name", { length: 100 }).notNull().unique(),
	enabled: boolean("enabled").default(false).notNull(),
	description: text("description"),

	// Rollout configuration
	rolloutPercentage: integer("rollout_percentage").default(0).notNull(), // 0-100
	allowedUsers: text("allowed_users"), // JSON array of user IDs
	allowedRoles: text("allowed_roles"), // JSON array of roles

	// Metadata
	createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
	updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
	updatedBy: text("updated_by"), // user ID who last updated
});

// ============================================================================
// EXPORTS
// ============================================================================

export type CarteraBackReference = typeof carteraBackReferences.$inferSelect;
export type NewCarteraBackReference = typeof carteraBackReferences.$inferInsert;

export type PagoReference = typeof pagoReferences.$inferSelect;
export type NewPagoReference = typeof pagoReferences.$inferInsert;

export type CarteraBackSyncLog = typeof carteraBackSyncLog.$inferSelect;
export type NewCarteraBackSyncLog = typeof carteraBackSyncLog.$inferInsert;

export type CarteraBackFeatureFlag = typeof carteraBackFeatureFlags.$inferSelect;
export type NewCarteraBackFeatureFlag = typeof carteraBackFeatureFlags.$inferInsert;
