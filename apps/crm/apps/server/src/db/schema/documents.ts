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

// Tipos de documentos que pertenecen al vehículo
// Usado para validar si un documento debe sincronizarse con vehicleDocuments
export const VEHICLE_DOCUMENT_TYPES = [
	"tarjeta_circulacion",
	"titulo_propiedad",
	"dpi_dueno",
	"patente_comercio_vehiculo",
	"representacion_legal_vehiculo",
	"dpi_representante_legal_vehiculo",
	"pago_impuesto_circulacion",
	"consulta_sat",
	"consulta_garantias_mobiliarias",
	"datos_vehiculo_nuevo",
	"cotizacion_vehiculo_nuevo",
] as const;

export type VehicleDocumentType = (typeof VEHICLE_DOCUMENT_TYPES)[number];

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
	"datos_vehiculo_nuevo", // Documentos del vehículo nuevo (factura, contrato, etc.)
	"cotizacion_vehiculo_nuevo", // Cotización del vehículo nuevo

	// === VERIFICACIONES DE CLIENTE ===
	"usuario_sat_cliente", // Usuario de SAT (Cliente)
	"rtu_cliente", // RTU (Cliente)
	"omisos_incumplimientos_cliente", // Omisos e Incumplimientos (Cliente)
	"infornet", // Infornet (PEP, No pago mora, Sin demandas, Si cumple)
	"confirmacion_referencias", // Confirmación de Referencias (Laborales - Personales)
	"visita_domiciliar", // Visita Domiciliar
	"redes_sociales_internet", // Redes Sociales - Internet
	"enganche", // Comprobante de enganche

	// === VERIFICACIONES DE VEHÍCULO / PROPIETARIO ===
	"usuario_sat_propietario", // Usuario de SAT (Propietario del vehículo)
	"rtu_propietario", // RTU (Propietario del Vehículo)
	"omisos_incumplimientos_propietario", // Omisos e Incumplimientos (Propietario del Vehículo)
	"garantia_mobiliaria_sat", // Garantía Mobiliaria desde SAT
	"garantia_mobiliaria_dpi", // Garantía Mobiliaria con DPI del Propietario (desde el Registro)
	"garantia_mobiliaria_nit", // Garantía Mobiliaria con NIT del Propietario (desde el Registro)
	"garantia_mobiliaria_serie", // Garantía Mobiliaria con SERIE (desde el Registro)
	"multas_vehiculo", // Multas del vehículo

	// === DOCUMENTOS ETAPA 90% (CIERRE) ===
	"seguro_vehiculo", // Asegurar el Vehículo
	"inscripcion_garantia_mobiliaria", // Inscripción de Garantía Mobiliaria
	"traspaso", // Traspaso
	"documentos_firmados_vendedor", // Documentos que firma el vendedor
	"copia_llave", // Copia de llave
	"confirmacion_enganche", // Confirmación de Enganche
	"desembolso", // Desembolso

	// Categorías generales (legacy - mantener por compatibilidad)
	"identification", // DPI, pasaporte
	"income_proof", // Comprobantes de ingresos
	"bank_statement", // Estados de cuenta
	"business_license", // Patente de comercio
	"property_deed", // Escrituras
	"vehicle_title", // Tarjeta de circulación
	"credit_report", // Reporte crediticio
	"other", // Otros documentos

	// Documento de detalle de análisis (requerido para pasar de 40% a 50%)
	"detalle_analisis", // Archivo Excel con detalle del crédito
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

// Disbursement Verification Type enum - Tipos de verificaciones para desembolso (90% → 100%)
export const disbursementVerificationTypeEnum = pgEnum(
	"disbursement_verification_type",
	[
		"traspaso_realizado", // Traspaso del vehículo realizado
		"documentos_enviados_asesor", // Documentos enviados al asesor para firmas del vendedor
		"documentos_firmados_recibidos", // Documentos firmados recibidos
		"copia_llave_recibida", // Copia de llave recibida
		"enganche_validado", // Enganche completo validado
		"listo_desembolsar", // Listo para desembolsar
	],
);

// Disbursement Checklists - Estado completo del checklist de desembolso (90% → 100%)
export const disbursementChecklists = pgTable("disbursement_checklists", {
	id: uuid("id").primaryKey().defaultRandom(),
	opportunityId: uuid("opportunity_id")
		.notNull()
		.unique()
		.references(() => opportunities.id, { onDelete: "cascade" }),
	// Items del checklist
	traspasoRealizado: boolean("traspaso_realizado").default(false),
	documentosEnviadosAsesor: boolean("documentos_enviados_asesor").default(
		false,
	),
	documentosFirmadosRecibidos: boolean("documentos_firmados_recibidos").default(
		false,
	),
	copiaLlaveRecibida: boolean("copia_llave_recibida").default(false),
	engancheValidado: boolean("enganche_validado").default(false),
	listoDesembolsar: boolean("listo_desembolsar").default(false),
	// Notas opcionales
	notes: text("notes"),
	// Metadata
	completedBy: text("completed_by").references(() => user.id),
	completedAt: timestamp("completed_at"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
