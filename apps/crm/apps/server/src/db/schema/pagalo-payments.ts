/**
 * Orquestación Págalo de CB-028 — modelo reducido para MVP.
 *
 * RESPONSABILIDAD DEL CRM
 * ----------------------
 * CRM conserva intención creada por asesor, snapshot de cuotas/rubros, dos
 * links Págalo, transacciones observadas, vouchers y bitácora. Cartera-back
 * conserva aplicación financiera real e idempotencia final de pagos_credito.
 *
 * MODELO (3 TABLAS)
 * -----------------
 * pagalo_payment_groups  1 ── N pagalo_payment_links
 *          │
 *          └──────────── 1 ── N pagalo_payment_events
 *
 * Negocio exige dos links independientes por grupo:
 *   - CAPITAL: no facturable.
 *   - MORA_INTERES: facturable.
 *
 * Pagar uno deja grupo PARTIALLY_PAID. Grupo pasa a READY_TO_APPLY únicamente
 * cuando ambos tipos tienen link ACCEPT marcado application_source y voucher
 * disponible. COMPLETED significa que cartera confirmó aplicación, no solo que
 * Págalo recibió ambas transacciones.
 *
 * SEGURIDAD
 * ---------
 * JSONs son sanitizados antes de persistir. Nunca guardar header authorization,
 * Bearer token, número completo de tarjeta, CVV ni fecha de expiración. Campos
 * request_auth contienen referencia comercial devuelta por Págalo, no secreto.
 *
 * POR QUÉ ESTADOS SON TEXT
 * ------------------------
 * Estados internos usan text tipado + CHECK. Cambiar máquina futura requiere
 * ajustar CHECK, pero evita rigidez/rollback complejo de pgEnum. Estado externo
 * de Págalo queda abierto para no perder evidencia si proveedor agrega valores.
 */

import { sql } from "drizzle-orm";
import {
	type AnyPgColumn,
	boolean,
	check,
	foreignKey,
	index,
	integer,
	jsonb,
	numeric,
	pgTable,
	serial,
	text,
	timestamp,
	unique,
	uniqueIndex,
	uuid,
	varchar,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { casosCobros, contactosCobros } from "./cobros";

export type PagaloPaymentGroupStatus =
	| "DRAFT"
	| "LINKS_PENDING"
	| "PENDING_PAYMENT"
	| "PARTIALLY_PAID"
	| "READY_TO_APPLY"
	| "APPLYING"
	| "COMPLETED"
	| "APPLICATION_FAILED"
	| "REVIEW_REQUIRED"
	| "CANCELLED";

export type PagaloEnvironment = "STAGING" | "PRODUCTION";
export type PagaloLinkType = "CAPITAL" | "MORA_INTERES";

export type PagaloPaymentLinkStatus =
	| "CREATING"
	| "ACTIVE"
	| "PAID"
	| "REJECTED"
	| "CANCELLED"
	| "EXPIRED"
	| "REPLACED"
	| "ERROR";

export type PagaloVoucherSource = "NONE" | "PAGALO" | "GENERATED";

/**
 * Cabecera de intención de cobro.
 *
 * `allocationsSnapshot` reemplaza tabla separada de allocations para mantener
 * MVP pequeño. Formato esperado:
 *
 * [{
 *   link_type: "CAPITAL" | "MORA_INTERES",
 *   cartera_cuota_id: number | null,
 *   numero_cuota: number | null,
 *   rubro: "CAPITAL" | "INTERES" | "IVA" | "MORA",
 *   amount: "100.00",
 *   facturable: boolean,
 *   calculation_snapshot: { ...valores fuente sanitizados }
 * }]
 *
 * Snapshot es inmutable después de generar links: deuda posterior puede cambiar,
 * pero auditoría debe explicar monto originalmente ofrecido. Servicio valida:
 * CAPITAL no facturable; INTERES/MORA/IVA facturables; sumas coinciden con
 * capitalTotal/facturableTotal/totalAmount.
 *
 * Esta misma fila funciona como outbox durable hacia cartera: status,
 * dispatchAttemptCount, nextDispatchAt y lease evitan tabla adicional. Worker
 * reclama READY_TO_APPLY/APPLICATION_FAILED con FOR UPDATE SKIP LOCKED.
 */
export const pagaloPaymentGroups = pgTable(
	"pagalo_payment_groups",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		casoCobroId: uuid("caso_cobro_id").references(() => casosCobros.id, {
			onDelete: "set null",
		}),
		/** Gestión concreta visible en Historial. */
		contactoCobroId: uuid("contacto_cobro_id").references(
			() => contactosCobros.id,
			{ onDelete: "set null" },
		),
		numeroCreditoSifco: varchar("numero_credito_sifco", {
			length: 40,
		}).notNull(),
		// ID opaco de cartera-back: bases separadas, sin FK local.
		carteraCreditoId: integer("cartera_credito_id").notNull(),
		pagaloEnvironment: text("pagalo_environment")
			.$type<PagaloEnvironment>()
			.notNull(),
		currency: varchar("currency", { length: 3 }).notNull().default("GTQ"),

		capitalTotal: numeric("capital_total", {
			precision: 18,
			scale: 2,
		}).notNull(),
		facturableTotal: numeric("facturable_total", {
			precision: 18,
			scale: 2,
		}).notNull(),
		totalAmount: numeric("total_amount", {
			precision: 18,
			scale: 2,
		}).notNull(),
		allocationsSnapshot: jsonb("allocations_snapshot").notNull(),

		status: text("status")
			.$type<PagaloPaymentGroupStatus>()
			.notNull()
			.default("DRAFT"),

		/** MVP false/null. Snapshot permite activar política global después. */
		expirationEnabled: boolean("expiration_enabled").notNull().default(false),
		expirationHours: integer("expiration_hours"),

		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		readyToApplyAt: timestamp("ready_to_apply_at", { withTimezone: true }),
		sentToCarteraAt: timestamp("sent_to_cartera_at", {
			withTimezone: true,
		}),
		applicationStartedAt: timestamp("application_started_at", {
			withTimezone: true,
		}),
		completedAt: timestamp("completed_at", { withTimezone: true }),
		cancelledAt: timestamp("cancelled_at", { withTimezone: true }),

		/** SHA-256 hex del payload normalizado enviado a cartera. */
		applicationPayloadHash: varchar("application_payload_hash", { length: 64 }),
		carteraImportId: integer("cartera_import_id"),
		dispatchAttemptCount: integer("dispatch_attempt_count")
			.notNull()
			.default(0),
		nextDispatchAt: timestamp("next_dispatch_at", { withTimezone: true }),
		dispatchClaimedAt: timestamp("dispatch_claimed_at", {
			withTimezone: true,
		}),
		dispatchClaimToken: uuid("dispatch_claim_token"),
		lastDispatchError: text("last_dispatch_error"),

		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		index("pagalo_payment_groups_status_idx").on(t.status),
		index("pagalo_payment_groups_credit_idx").on(
			t.numeroCreditoSifco,
			t.createdAt,
		),
		index("pagalo_payment_groups_case_idx").on(t.casoCobroId),
		uniqueIndex("pagalo_payment_groups_contact_uq").on(t.contactoCobroId),
		index("pagalo_payment_groups_dispatch_idx")
			.on(t.nextDispatchAt)
			.where(sql`${t.status} IN ('READY_TO_APPLY', 'APPLICATION_FAILED')`),
		index("pagalo_payment_groups_dispatch_claim_idx")
			.on(t.dispatchClaimedAt)
			.where(sql`${t.status} = 'APPLYING'`),
		check(
			"pagalo_payment_groups_status_chk",
			sql`${t.status} IN (
				'DRAFT', 'LINKS_PENDING', 'PENDING_PAYMENT', 'PARTIALLY_PAID',
				'READY_TO_APPLY', 'APPLYING', 'COMPLETED', 'APPLICATION_FAILED',
				'REVIEW_REQUIRED', 'CANCELLED'
			)`,
		),
		check(
			"pagalo_payment_groups_environment_chk",
			sql`${t.pagaloEnvironment} IN ('STAGING', 'PRODUCTION')`,
		),
		check(
			"pagalo_payment_groups_amounts_chk",
			sql`${t.capitalTotal} > 0 AND ${t.facturableTotal} > 0 AND ${t.totalAmount} > 0`,
		),
		check(
			"pagalo_payment_groups_total_matches_chk",
			sql`${t.totalAmount} = ${t.capitalTotal} + ${t.facturableTotal}`,
		),
		check(
			"pagalo_payment_groups_allocations_array_chk",
			sql`jsonb_typeof(${t.allocationsSnapshot}) = 'array' AND jsonb_array_length(${t.allocationsSnapshot}) > 0`,
		),
		check(
			"pagalo_payment_groups_expiration_chk",
			sql`(${t.expirationEnabled} = false AND ${t.expirationHours} IS NULL)
				OR (${t.expirationEnabled} = true AND ${t.expirationHours} IS NOT NULL AND ${t.expirationHours} > 0)`,
		),
		check(
			"pagalo_payment_groups_dispatch_attempts_chk",
			sql`${t.dispatchAttemptCount} >= 0`,
		),
		check(
			"pagalo_payment_groups_payload_hash_chk",
			sql`${t.applicationPayloadHash} IS NULL OR ${t.applicationPayloadHash} ~ '^[0-9a-f]{64}$'`,
		),
	],
);

/**
 * Generaciones físicas de links y transacción final observada.
 *
 * Componente, intento de creación, transacción y voucher viven juntos porque
 * Págalo permite usar link una sola vez. Regenerar crea fila generation N+1;
 * nunca sobrescribe anterior. Link antiguo y reemplazo pueden quedar pagados:
 * ambos se conservan, pero partial UNIQUE permite solo uno application_source
 * por (grupo,tipo). Exceso termina REVIEW_REQUIRED.
 */
export const pagaloPaymentLinks = pgTable(
	"pagalo_payment_links",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		groupId: uuid("group_id")
			.notNull()
			.references(() => pagaloPaymentGroups.id),
		linkType: text("link_type").$type<PagaloLinkType>().notNull(),
		generation: integer("generation").notNull().default(1),

		externalIdentifier: varchar("external_identifier", {
			length: 150,
		}).notNull(),
		pagaloRequestUuid: varchar("pagalo_request_uuid", { length: 64 }),
		pagaloShortUuid: varchar("pagalo_short_uuid", { length: 64 }),
		paymentUrl: text("payment_url"),
		apiBaseUrl: text("api_base_url").notNull(),
		status: text("status")
			.$type<PagaloPaymentLinkStatus>()
			.notNull()
			.default("CREATING"),

		// JSONs sanitizados; nunca headers/tokens/tarjeta.
		requestPayload: jsonb("request_payload").notNull(),
		responsePayload: jsonb("response_payload"),
		httpStatus: integer("http_status"),
		errorCode: text("error_code"),
		errorMessage: text("error_message"),

		/** Datos de transacción aparecen cuando callback/job la observa. */
		pagaloTransactionUuid: varchar("pagalo_transaction_uuid", { length: 64 }),
		transactionStatus: text("transaction_status"),
		transactionAmount: numeric("transaction_amount", {
			precision: 18,
			scale: 2,
		}),
		transactionCurrency: varchar("transaction_currency", { length: 3 }),
		requestId: varchar("request_id", { length: 100 }),
		requestAuth: varchar("request_auth", { length: 100 }),
		isApplicationSource: boolean("is_application_source")
			.notNull()
			.default(false),

		voucherSource: text("voucher_source")
			.$type<PagaloVoucherSource>()
			.notNull()
			.default("NONE"),
		voucherUrl: text("voucher_url"),
		voucherStorageKey: text("voucher_storage_key"),
		voucherSha256: varchar("voucher_sha256", { length: 64 }),
		voucherGeneratedAt: timestamp("voucher_generated_at", {
			withTimezone: true,
		}),

		expiresAt: timestamp("expires_at", { withTimezone: true }),
		supersedesLinkId: uuid("supersedes_link_id").references(
			(): AnyPgColumn => pagaloPaymentLinks.id,
			{ onDelete: "set null" },
		),

		/** Lease/backoff para job; callback escribe idempotentemente misma fila. */
		nextPollAt: timestamp("next_poll_at", { withTimezone: true }),
		pollClaimedAt: timestamp("poll_claimed_at", { withTimezone: true }),
		pollAttempts: integer("poll_attempts").notNull().default(0),
		lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
		lastPollError: text("last_poll_error"),

		requestedBy: text("requested_by")
			.notNull()
			.references(() => user.id),
		requestedAt: timestamp("requested_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		activatedAt: timestamp("activated_at", { withTimezone: true }),
		paidAt: timestamp("paid_at", { withTimezone: true }),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		updatedAt: timestamp("updated_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		uniqueIndex("pagalo_payment_links_external_id_uq").on(t.externalIdentifier),
		uniqueIndex("pagalo_payment_links_request_uuid_uq").on(t.pagaloRequestUuid),
		uniqueIndex("pagalo_payment_links_transaction_uuid_uq").on(
			t.pagaloTransactionUuid,
		),
		uniqueIndex("pagalo_payment_links_generation_uq").on(
			t.groupId,
			t.linkType,
			t.generation,
		),
		// Clave candidata usada para amarrar event.link_id con mismo group_id.
		unique("pagalo_payment_links_id_group_uq").on(t.id, t.groupId),
		uniqueIndex("pagalo_payment_links_active_type_uq")
			.on(t.groupId, t.linkType)
			.where(sql`${t.status} IN ('CREATING', 'ACTIVE')`),
		uniqueIndex("pagalo_payment_links_application_source_uq")
			.on(t.groupId, t.linkType)
			.where(sql`${t.isApplicationSource} = true`),
		index("pagalo_payment_links_group_idx").on(t.groupId),
		index("pagalo_payment_links_poll_idx")
			.on(t.nextPollAt)
			.where(sql`${t.status} IN ('CREATING', 'ACTIVE')`),
		check(
			"pagalo_payment_links_type_chk",
			sql`${t.linkType} IN ('CAPITAL', 'MORA_INTERES')`,
		),
		check(
			"pagalo_payment_links_status_chk",
			sql`${t.status} IN (
				'CREATING', 'ACTIVE', 'PAID', 'REJECTED', 'CANCELLED',
				'EXPIRED', 'REPLACED', 'ERROR'
			)`,
		),
		check("pagalo_payment_links_generation_chk", sql`${t.generation} > 0`),
		check(
			"pagalo_payment_links_poll_attempts_chk",
			sql`${t.pollAttempts} >= 0`,
		),
		check(
			"pagalo_payment_links_transaction_amount_chk",
			sql`${t.transactionAmount} IS NULL OR ${t.transactionAmount} > 0`,
		),
		check(
			"pagalo_payment_links_application_source_chk",
			sql`${t.isApplicationSource} = false OR (
				${t.transactionStatus} IS NOT NULL
				AND ${t.transactionStatus} = 'ACCEPT'
				AND ${t.pagaloTransactionUuid} IS NOT NULL
				AND ${t.transactionAmount} IS NOT NULL
				AND ${t.paidAt} IS NOT NULL
				AND ${t.voucherSource} <> 'NONE'
			)`,
		),
		check(
			"pagalo_payment_links_voucher_source_chk",
			sql`${t.voucherSource} IN ('NONE', 'PAGALO', 'GENERATED')`,
		),
		check(
			"pagalo_payment_links_voucher_shape_chk",
			sql`(${t.voucherSource} = 'NONE' AND ${t.voucherUrl} IS NULL AND ${t.voucherStorageKey} IS NULL AND ${t.voucherSha256} IS NULL AND ${t.voucherGeneratedAt} IS NULL)
				OR (${t.voucherSource} = 'PAGALO' AND ${t.voucherUrl} IS NOT NULL)
				OR (${t.voucherSource} = 'GENERATED' AND ${t.voucherUrl} IS NOT NULL AND ${t.voucherStorageKey} IS NOT NULL AND ${t.voucherSha256} IS NOT NULL AND ${t.voucherGeneratedAt} IS NOT NULL)`,
		),
	],
);

/**
 * Auditoría append-only.
 *
 * Responde quién creó, parámetros/link relacionado, cuándo se envió al cliente,
 * cuándo fue validado, reintentos, respuesta de cartera y errores. No reemplaza
 * estado actual. actorUserId NULL representa webhook/job/sistema. Payload pequeño
 * y sanitizado; detalles grandes ya viven en request/response del link.
 */
export const pagaloPaymentEvents = pgTable(
	"pagalo_payment_events",
	{
		id: serial("id").primaryKey(),
		groupId: uuid("group_id")
			.notNull()
			.references(() => pagaloPaymentGroups.id),
		// Nullable para eventos del grupo que no pertenecen a un link concreto.
		linkId: uuid("link_id"),
		eventType: text("event_type").notNull(),
		source: text("source").notNull(),
		actorUserId: text("actor_user_id").references(() => user.id),
		fromStatus: text("from_status"),
		toStatus: text("to_status"),
		payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
		occurredAt: timestamp("occurred_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
		createdAt: timestamp("created_at", { withTimezone: true })
			.notNull()
			.defaultNow(),
	},
	(t) => [
		// Si linkId existe, obliga que link pertenezca al groupId declarado.
		// MATCH SIMPLE permite linkId NULL para eventos GROUP_CREATED/GROUP_READY.
		foreignKey({
			name: "pagalo_payment_events_link_group_fk",
			columns: [t.linkId, t.groupId],
			foreignColumns: [pagaloPaymentLinks.id, pagaloPaymentLinks.groupId],
		}),
		index("pagalo_payment_events_group_time_idx").on(t.groupId, t.occurredAt),
		index("pagalo_payment_events_type_idx").on(t.eventType, t.occurredAt),
		index("pagalo_payment_events_link_idx").on(t.linkId),
	],
);
