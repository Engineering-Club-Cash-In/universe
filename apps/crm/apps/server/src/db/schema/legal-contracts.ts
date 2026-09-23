import {
	index,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uniqueIndex,
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

	/**
	 * Links de firma en posiciones fijas.
	 * @deprecated Sólo sirve para los contratos viejos. El link de cada persona
	 * vive en `contractSignatories`, con su rol: acá el "representante" era
	 * simplemente el segundo link, y cuando había cofirmante ese segundo link
	 * era del cofirmante, no del representante legal.
	 */
	clientSigningLink: text("client_signing_link"), // Link del cliente
	representativeSigningLink: text("representative_signing_link"), // Link del representante
	additionalSigningLinks: text("additional_signing_links").array(), // Links adicionales si aplica
	pdfLink: text("pdf_link"), // Link del PDF subido a R2 (opcional)

	// Proveedor de firma electrónica usado ("weetrust" | "documenso").
	signingProvider: text("signing_provider"),

	/**
	 * ID del documento en WeeTrust. Sin esto no se puede consultar el estado de
	 * firma ni reintentar la verificación de nadie: había que sacarlo a mano del
	 * link guardado (`/signatory/{documentID}/{signatoryID}/...`).
	 */
	weetrustDocumentId: text("weetrust_document_id"),

	/**
	 * Cómo se firma: "electronica" o "fisica". Un contrato físico sin links no
	 * está incompleto, se firma en papel.
	 */
	signatureMode: text("signature_mode").notNull().default("electronica"),

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

// Tabla para guardar snapshots de generación de contratos (para regenerar con nueva fecha)
export const contractGenerationSnapshots = pgTable(
	"contract_generation_snapshots",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		// Relación con oportunidad
		opportunityId: uuid("opportunity_id")
			.notNull()
			.references(() => opportunities.id, { onDelete: "cascade" }),

		// Fecha del contrato usada en la generación
		contractDate: timestamp("contract_date").notNull(),

		// Data de generación (input.contracts del endpoint generateContractsDirect)
		data: jsonb("data").notNull(),

		// Auditoría
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
);

// Estado de firma de una persona concreta dentro de un contrato
export const contractSignatoryStatusEnum = pgEnum("contract_signatory_status", [
	"pending",
	"signed",
	"declined",
]);

/**
 * Quién firma cada contrato, con su rol y su link.
 *
 * Antes los links se guardaban por posición (`clientSigningLink`,
 * `representativeSigningLink`, `additionalSigningLinks`) asumiendo que el orden
 * era siempre titular → representante → resto. No lo es: hay templates donde el
 * representante legal firma primero, y en cuanto había un cofirmante el link
 * que se mostraba como "Rep. Legal" era en realidad el del cofirmante.
 *
 * Acá cada firmante queda con su rol, su `signatoryID` de WeeTrust y su estado,
 * que es lo que hace falta para mostrar quién falta y para reintentarle a una
 * sola persona sin regenerar el documento entero.
 */
export const contractSignatories = pgTable(
	"contract_signatories",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		contractId: uuid("contract_id")
			.notNull()
			.references(() => generatedLegalContracts.id, { onDelete: "cascade" }),

		/** TITULAR | COFIRMANTE | REP_LEGAL | VENDEDOR */
		role: text("role").notNull(),
		email: text("email").notNull(),
		name: text("name").notNull(),

		/** Identificador del firmante dentro del documento de WeeTrust. */
		weetrustSignatoryId: text("weetrust_signatory_id"),
		signingUrl: text("signing_url"),

		/** Orden en que WeeTrust devolvió al firmante, sólo para mostrarlo estable. */
		position: integer("position").notNull().default(0),

		status: contractSignatoryStatusEnum("status").notNull().default("pending"),
		signedAt: timestamp("signed_at"),

		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(table) => [
		index("contract_signatories_contract_idx").on(table.contractId),
		// WeeTrust manda un solo link por correo aunque la persona firme en
		// varias líneas del mismo documento.
		uniqueIndex("contract_signatories_contract_email_unique").on(
			table.contractId,
			table.email,
		),
	],
);
