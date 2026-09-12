import { sql } from "drizzle-orm";
import {
	check,
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	primaryKey,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import type { Signal } from "../../lib/document-integrity/types";
import { user } from "./auth";
import { opportunities } from "./crm";
import { documentTypeEnum, opportunityDocuments } from "./documents";

export const documentValidationResultEnum = pgEnum(
	"document_validation_result",
	["valido", "observacion", "revision_manual", "rechazado", "error"],
);

export const documentValidationSourceEnum = pgEnum(
	"document_validation_source",
	["documentacion", "analisis_capacidad"],
);

export const documentValidationRunStatusEnum = pgEnum(
	"document_validation_run_status",
	["processing", "completed", "error"],
);

export const documentIntegrityValidationRuns = pgTable(
	"document_integrity_validation_runs",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		opportunityId: uuid("opportunity_id")
			.notNull()
			.references(() => opportunities.id, { onDelete: "cascade" }),
		attemptNumber: integer("attempt_number").notNull(),
		status: documentValidationRunStatusEnum("status")
			.notNull()
			.default("processing"),
		validationSource:
			documentValidationSourceEnum("validation_source").notNull(),
		requestedBy: text("requested_by")
			.notNull()
			.references(() => user.id),
		startedAt: timestamp("started_at", { withTimezone: true })
			.notNull()
			.default(sql`clock_timestamp()`),
		completedAt: timestamp("completed_at", { withTimezone: true }),
	},
	(table) => [
		uniqueIndex("doc_integrity_run_opp_attempt_unique").on(
			table.opportunityId,
			table.attemptNumber,
		),
		index("doc_integrity_run_opportunity_idx").on(
			table.opportunityId,
			table.startedAt.desc(),
		),
	],
);

export const documentIntegrityValidationResets = pgTable(
	"document_integrity_validation_resets",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		opportunityId: uuid("opportunity_id")
			.notNull()
			.references(() => opportunities.id, { onDelete: "cascade" }),
		resetAfterAttemptNumber: integer("reset_after_attempt_number").notNull(),
		resetBy: text("reset_by")
			.notNull()
			.references(() => user.id),
		resetAt: timestamp("reset_at", { withTimezone: true })
			.notNull()
			.default(sql`clock_timestamp()`),
	},
	(table) => [
		index("doc_integrity_reset_opportunity_idx").on(
			table.opportunityId,
			table.resetAfterAttemptNumber.desc(),
		),
	],
);

export const documentIntegrityValidations = pgTable(
	"document_integrity_validations",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		validationRunId: uuid("validation_run_id")
			.notNull()
			.references(() => documentIntegrityValidationRuns.id, {
				onDelete: "cascade",
			}),
		documentType: documentTypeEnum("document_type").notNull(),

		documentFilePath: text("document_file_path").notNull(),
		contentSha256: text("content_sha256").notNull(),

		autoResult: documentValidationResultEnum("auto_result").notNull(),
		autoScore: integer("auto_score").notNull().default(0),
		autoReason: text("auto_reason").notNull(),

		signals: jsonb("signals")
			.$type<Signal[]>()
			.notNull()
			.default(sql`'[]'::jsonb`),
		technicalFingerprint: jsonb("technical_fingerprint").$type<
			Record<string, unknown>
		>(),
		aiRawResponse: jsonb("ai_raw_response").$type<Record<string, unknown>>(),

		retryCount: integer("retry_count").notNull().default(0),
		errorMessage: text("error_message"),
	},
	(table) => [
		index("doc_integrity_val_run_idx").on(table.validationRunId),
		index("doc_integrity_val_result_idx").on(table.autoResult),
		index("doc_integrity_val_sha_idx").on(table.contentSha256),
		index("doc_integrity_val_identifier_normalized_idx").on(
			sql`upper(regexp_replace(coalesce(${table.aiRawResponse}->>'identificador_detectado', ''), '[^A-Za-z0-9]', '', 'g'))`,
		),
		// jsonb_path_ops explícito: es la clase de operadores con la que la
		// migración 0033 crea el índice, y el default de Drizzle es jsonb_ops.
		index("doc_integrity_val_signals_gin_idx").using(
			"gin",
			table.signals.op("jsonb_path_ops"),
		),
	],
);

export const documentIntegrityValidationDocuments = pgTable(
	"document_integrity_validation_documents",
	{
		validationId: uuid("validation_id")
			.notNull()
			.references(() => documentIntegrityValidations.id, {
				onDelete: "cascade",
			}),
		opportunityDocumentId: uuid("opportunity_document_id")
			.notNull()
			.references(() => opportunityDocuments.id, {
				onDelete: "cascade",
			}),
		linkedFilePath: text("linked_file_path").notNull(),
	},
	(table) => [
		primaryKey({
			name: "doc_integrity_val_document_pk",
			columns: [table.validationId, table.opportunityDocumentId],
		}),
		index("doc_integrity_val_document_opp_doc_idx").on(
			table.opportunityDocumentId,
		),
	],
);

export const documentIntegrityValidationApprovals = pgTable(
	"document_integrity_validation_approvals",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		validationId: uuid("validation_id")
			.notNull()
			.references(() => documentIntegrityValidations.id, {
				onDelete: "cascade",
			}),
		approvedBy: text("approved_by")
			.notNull()
			.references(() => user.id),
		reason: text("reason").notNull(),
		approvedAt: timestamp("approved_at", { withTimezone: true })
			.notNull()
			.default(sql`clock_timestamp()`),
	},
	(table) => [
		uniqueIndex("doc_integrity_approval_validation_unique").on(
			table.validationId,
		),
		check(
			"doc_integrity_approval_reason_not_blank",
			sql`length(btrim(${table.reason})) between 5 and 1000`,
		),
	],
);
