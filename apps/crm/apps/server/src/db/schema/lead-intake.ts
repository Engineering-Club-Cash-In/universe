import {
	pgTable,
	text,
	timestamp,
	uniqueIndex,
	uuid,
} from "drizzle-orm/pg-core";
import { leads } from "./crm";

// Respuestas autodeclaradas de formularios de captación (ej. Meta Instant Forms),
// modelo llave-valor para no requerir migración cuando marketing agregue una pregunta nueva.
// campaignFormKey identifica de qué formulario/campaña viene cada respuesta, para que
// dos formularios distintos puedan reusar el mismo fieldKey sin pisarse entre sí.
export const leadIntakeAnswers = pgTable(
	"lead_intake_answers",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		leadId: uuid("lead_id")
			.notNull()
			.references(() => leads.id, { onDelete: "cascade" }),
		campaignFormKey: text("campaign_form_key").notNull(),
		fieldKey: text("field_key").notNull(),
		fieldValue: text("field_value"),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(table) => ({
		leadFormFieldUnique: uniqueIndex(
			"lead_intake_answers_lead_form_field_unique",
		).on(table.leadId, table.campaignFormKey, table.fieldKey),
	}),
);
