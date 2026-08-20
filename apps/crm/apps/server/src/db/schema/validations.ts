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

		/** Vigencia del resultado (copiada del caché de Infornet cuando aplica) */
		expiraEn: timestamp("expira_en"),

		/** Usuario que disparó la ejecución (null si fue el sistema) */
		ejecutadoPor: text("ejecutado_por").references(() => user.id),

		/** Fecha y hora de la ejecución */
		ejecutadoAt: timestamp("ejecutado_at").notNull().defaultNow(),
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
