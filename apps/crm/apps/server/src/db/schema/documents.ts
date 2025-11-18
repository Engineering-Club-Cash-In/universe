import {
	boolean,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { clientTypeEnum, creditTypeEnum, opportunities } from "./crm";

export const documentTypeEnum = pgEnum("document_type", [
	// Documentos específicos para análisis (Individual y Comerciante)
	"dpi", // DPI vigente
	"licencia", // Licencia vigente
	"recibo_luz", // Recibo de luz (no mayor a 2 meses)
	"recibo_adicional", // Recibo adicional con misma dirección
	"formularios", // Formularios completamente llenos
	"estados_cuenta_1", // Estado de cuenta mes 1
	"estados_cuenta_2", // Estado de cuenta mes 2
	"estados_cuenta_3", // Estado de cuenta mes 3

	// Documentos para comerciantes
	"patente_comercio", // Patente de comercio

	// Documentos para empresas (S.A)
	"representacion_legal", // Representación Legal
	"constitucion_sociedad", // Constitución de sociedad
	"patente_mercantil", // Patente de comercio y mercantil
	"iva_1", // Formulario IVA mes 1
	"iva_2", // Formulario IVA mes 2
	"iva_3", // Formulario IVA mes 3
	"estado_financiero", // Estado financiero último año
	"clausula_consentimiento", // Cláusula de consentimiento de la empresa
	"minutas", // Minutas

	// Documentos específicos de vehículos
	"tarjeta_circulacion", // Tarjeta de circulación del vehículo
	"titulo_propiedad", // Título de propiedad del vehículo
	"dpi_dueno", // DPI del dueño (cuando vehículo a nombre de individual)
	"patente_comercio_vehiculo", // Patente de comercio (empresa individual)
	"representacion_legal_vehiculo", // Representación legal (S.A)
	"dpi_representante_legal_vehiculo", // DPI del representante legal (S.A)
	"pago_impuesto_circulacion", // Comprobante de pago de impuesto de circulación
	"consulta_sat", // Captura de pantalla de consulta SAT
	"consulta_garantias_mobiliarias", // Certificación de garantías mobiliarias (RGM)

	// Categorías generales (legacy - mantener por compatibilidad)
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

// Document Requirements By Client Type - Requisitos de documentos según tipo de cliente
export const documentRequirementsByClientType = pgTable(
	"document_requirements_by_client_type",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		clientType: clientTypeEnum("client_type").notNull(),
		creditType: creditTypeEnum("credit_type").notNull(),
		documentType: documentTypeEnum("document_type").notNull(),
		required: boolean("required").notNull().default(true),
		description: text("description"),
		order: integer("order"), // Para ordenar en checklist
	},
);

// Verification Type enum - Tipos de verificaciones del checklist
export const verificationTypeEnum = pgEnum("verification_type", [
	"rtu_pep", // RTU - Validar que no sea PEP
	"rtu_empresa", // RTU - Confirmar empresa registrada
	"revision_internet", // Revisar cliente/empresa en internet y redes
	"confirmacion_referencias", // Llamar referencias
	"confirmacion_trabajo", // Llamar lugar de trabajo
	"confirmacion_negocio", // Llamar negocio propio (si aplica)
	"capacidad_pago", // Análisis de capacidad de pago
	"infornet", // Consulta Infornet
	"verificacion_direccion", // Verificación de dirección domicilio
]);

// Analysis Checklists - Estado completo del checklist de análisis
export const analysisChecklists = pgTable("analysis_checklists", {
	id: uuid("id").primaryKey().defaultRandom(),
	opportunityId: uuid("opportunity_id")
		.notNull()
		.unique()
		.references(() => opportunities.id, { onDelete: "cascade" }),
	// JSON con estructura completa del checklist
	checklistData: jsonb("checklist_data").notNull(),
	// Metadata
	completedBy: text("completed_by").references(() => user.id),
	completedAt: timestamp("completed_at"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
