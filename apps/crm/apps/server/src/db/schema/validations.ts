import { sql } from "drizzle-orm";
import {
	index,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { opportunities } from "./crm";

/**
 * Tipos de validación externa ejecutables para una oportunidad.
 */
export const validationTipoEnum = pgEnum("validation_tipo", [
	"renap", // Sincronización de datos de identidad contra RENAP
	"buro", // Estudio de persona / buró de crédito (Infornet)
]);

/**
 * Estado final de una validación.
 */
export const validationEstadoEnum = pgEnum("validation_estado", [
	"aprobado", // Veredicto favorable
	"rechazado", // Veredicto desfavorable (buró: delitos penales o morosidad)
	"error", // Fallo técnico de la fuente externa (sin veredicto)
	"sin_registro", // La fuente respondió pero la persona no tiene registro
]);

/**
 * Bitácora de validaciones RENAP / Buró por oportunidad.
 *
 * Registra cada ejecución (resultado, fecha, fuente y estado) para las
 * oportunidades cuyo origen NO es el bot de WhatsApp; las oportunidades del
 * bot quedan exentas y no generan registros.
 *
 * El estudio completo del buró NO vive aquí: se guarda en
 * `infornet_persona_cache` (compartido por DPI, TTL de 30 días).
 */
export const opportunityValidations = pgTable(
	"opportunity_validations",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		/** Oportunidad validada */
		opportunityId: uuid("opportunity_id")
			.notNull()
			.references(() => opportunities.id, { onDelete: "cascade" }),

		/** DPI normalizado con el que se ejecutó la validación */
		dpi: text("dpi").notNull(),

		/** Tipo de validación (renap | buro) */
		tipo: validationTipoEnum("tipo").notNull(),

		/** Estado final (aprobado | rechazado | error | sin_registro) */
		estado: validationEstadoEnum("estado").notNull(),

		/** Motivos del rechazo o mensaje de error de la fuente externa */
		mensaje: text("mensaje"),

		// Campos exclusivos del buró
		scoreRiesgo: integer("score_riesgo"),
		nivelRiesgo: text("nivel_riesgo"),
		alertas: text("alertas").array(),

		/** Si el estudio salió del caché (30 días) o de la API de Infornet */
		fuenteDeDatos: text("fuente_de_datos"),

		/** Vigencia del resultado: del caché de Infornet, o 30 días si no hay registro */
		expiraEn: timestamp("expira_en"),

		/** Usuario que disparó la ejecución (null si fue el sistema) */
		ejecutadoPor: text("ejecutado_por").references(() => user.id),

		/**
		 * Fecha y hora de la ejecución. `clock_timestamp()`, no `now()`: bajo el
		 * candado de `pg_advisory_xact_lock` el orden real de los inserts puede
		 * no coincidir con el de inicio de cada transacción, y `now()` se congela
		 * al inicio de la transacción en vez de reflejar cuándo corrió el insert.
		 */
		ejecutadoAt: timestamp("ejecutado_at")
			.notNull()
			.default(sql`clock_timestamp()`),
	},
	(table) => [
		index("opportunity_validations_opportunity_id_idx").on(table.opportunityId),
		index("opportunity_validations_lookup_idx").on(
			table.opportunityId,
			table.tipo,
			table.ejecutadoAt.desc(),
		),
	],
);

/**
 * Log de overrides manuales sobre `opportunity_validations`.
 *
 * Cuando una fuente externa (Infornet o Centinela/RENAP) está caída y el
 * analista verifica al cliente a mano en el portal correspondiente, se
 * inserta una fila nueva en `opportunity_validations` (nunca se pisa la fila
 * de error real) y una fila aquí que registra quién lo marcó, con qué motivo
 * y sobre qué fallo puntual.
 */
export const opportunityValidationOverrideLogs = pgTable(
	"opportunity_validation_overrides_logs",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		/** Oportunidad sobre la que se hizo el override */
		opportunityId: uuid("opportunity_id")
			.notNull()
			.references(() => opportunities.id, { onDelete: "cascade" }),

		/** Fila creada por el override en opportunity_validations */
		validationId: uuid("validation_id")
			.notNull()
			.unique()
			.references(() => opportunityValidations.id, { onDelete: "cascade" }),

		/**
		 * Fila con estado:'error' que el override bypassea. NOT NULL a propósito:
		 * el código nunca inserta sin ella (marcarValidacionManual exige encontrar
		 * un error antes de overridear) y las filas de opportunity_validations
		 * nunca se borran, así que este invariante siempre se cumple en la práctica.
		 */
		overriddenValidationId: uuid("overridden_validation_id")
			.notNull()
			.references(() => opportunityValidations.id),

		/** Tipo de validación overrideada (renap | buro); redundante con `opportunity_validations.tipo` a propósito, para poder filtrar el log sin join */
		tipo: validationTipoEnum("tipo").notNull(),

		/** Motivo capturado del analista (obligatorio hoy desde la UI/API) */
		reason: text("reason"),

		/** Usuario que marcó el override */
		markedBy: text("marked_by")
			.notNull()
			.references(() => user.id),

		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => [
		index("opportunity_validation_overrides_logs_opportunity_id_idx").on(
			table.opportunityId,
		),
		index("opportunity_validation_overrides_logs_marked_by_idx").on(
			table.markedBy,
		),
	],
);
