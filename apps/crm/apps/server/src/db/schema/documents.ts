import {
	pgTable,
	text,
	timestamp,
	uuid,
	integer,
	pgEnum,
	boolean,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { opportunities, creditTypeEnum } from "./crm";

export const documentTypeEnum = pgEnum("document_type", [
	"identification", // DPI, pasaporte
	"income_proof", // Comprobantes de ingresos
	"bank_statement", // Estados de cuenta
	"business_license", // Patente de comercio
	"property_deed", // Escrituras
	"vehicle_title", // Tarjeta de circulación
	"credit_report", // Reporte crediticio
	"other", // Otros documentos
]);

export const opportunityDocuments = pgTable("opportunity_documents", {
	id: uuid("id").primaryKey().defaultRandom(),
	opportunityId: uuid("opportunity_id")
		.notNull()
		.references(() => opportunities.id, { onDelete: "cascade" }),
	filename: text("filename").notNull(),
	originalName: text("original_name").notNull(),
	mimeType: text("mime_type").notNull(),
	size: integer("size").notNull(), // en bytes
	documentType: documentTypeEnum("document_type").notNull(),
	description: text("description"),
	uploadedBy: text("uploaded_by")
		.notNull()
		.references(() => user.id),
	uploadedAt: timestamp("uploaded_at").notNull().defaultNow(),
	// Para almacenamiento, usaremos el sistema de archivos local
	// En producción se podría usar S3 o similar
	filePath: text("file_path").notNull(),
});

// Document Requirements table - Define qué documentos son requeridos por tipo de crédito
export const documentRequirements = pgTable("document_requirements", {
	id: uuid("id").primaryKey().defaultRandom(),
	creditType: creditTypeEnum("credit_type").notNull(),
	documentType: documentTypeEnum("document_type").notNull(),
	required: boolean("required").notNull().default(true),
	description: text("description"),
});

// Document Validations table - Tracking de validaciones realizadas por analistas
export const documentValidations = pgTable("document_validations", {
	id: uuid("id").primaryKey().defaultRandom(),
	opportunityId: uuid("opportunity_id")
		.notNull()
		.references(() => opportunities.id, { onDelete: "cascade" }),
	validatedBy: text("validated_by")
		.notNull()
		.references(() => user.id),
	validatedAt: timestamp("validated_at").notNull().defaultNow(),
	allDocumentsPresent: boolean("all_documents_present").notNull(),
	vehicleInspected: boolean("vehicle_inspected").notNull(),
	missingDocuments: text("missing_documents").array(),
	notes: text("notes"),
});