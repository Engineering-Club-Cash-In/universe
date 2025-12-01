import {
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { leads, opportunities } from "./crm";

// Enum para el estado de los contratos
export const contractStatusEnum = pgEnum("contract_status", [
	"pending",
	"signed",
	"cancelled",
]);

// Tabla de contratos legales generados
export const generatedLegalContracts = pgTable("generated_legal_contracts", {
	id: uuid("id").primaryKey().defaultRandom(),

	// Relaciones
	leadId: uuid("lead_id")
		.notNull()
		.references(() => leads.id, { onDelete: "cascade" }),
	opportunityId: uuid("opportunity_id").references(() => opportunities.id, {
		onDelete: "set null",
	}), // Asignable después

	// Metadata del contrato
	contractType: text("contract_type").notNull(), // 'contrato_privado_uso_carro_usado', etc.
	contractName: text("contract_name").notNull(), // "Contrato de Uso de Vehículo"

	// URLs de documentos en R2/Documenso (signing_links del API)
	clientSigningLink: text("client_signing_link"), // Link del cliente
	representativeSigningLink: text("representative_signing_link"), // Link del representante
	additionalSigningLinks: text("additional_signing_links").array(), // Links adicionales si aplica

	// Metadata de generación
	templateId: integer("template_id"),
	apiResponse: jsonb("api_response"), // Guardar response completo del API para referencia

	// Control de estado
	status: contractStatusEnum("status").notNull().default("pending"),

	// Auditoría
	generatedBy: text("generated_by")
		.notNull()
		.references(() => user.id),
	generatedAt: timestamp("generated_at").notNull().defaultNow(),

	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
