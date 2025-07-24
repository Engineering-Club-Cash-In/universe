import { pgTable, text, timestamp, uuid, integer, pgEnum } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { opportunities } from "./crm";

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