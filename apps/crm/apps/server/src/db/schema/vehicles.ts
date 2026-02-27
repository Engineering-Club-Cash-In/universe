import { relations } from "drizzle-orm";
import {
	boolean,
	decimal,
	integer,
	json,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./crm";
// Enum definition for vehicle status
// Available values:
// - pending: Vehicle is registered but not yet available
// - available: Vehicle is available for sale
// - sold: Vehicle has been sold
// - maintenance: Vehicle is under maintenance
// - auction: Vehicle is being sold at auction
export const vehicleStatusEnum = pgEnum("vehicle_status", [
	"pending",
	"available",
	"sold",
	"maintenance",
	"auction",
]);
export const inspectionStatusEnum = pgEnum("inspection_status", [
	"pending", // inspección en proceso
	"approved", // vehículo aprobado
	"rejected", // vehículo rechazado
	"auction", // vehículo enviado a remate
]);

// Enum for 360 inspection items status
export const INSPECTION_360_STATUSES = [
	"GOOD",
	"REGULAR",
	"BAD",
	"NA",
	"OK",
	"LEGACY_BAD",
] as const;

export const inspection360StatusEnum = pgEnum(
	"inspection_360_status",
	INSPECTION_360_STATUSES,
);

// Vehicle owner type - determines document requirements
export const vehicleOwnerTypeEnum = pgEnum("vehicle_owner_type", [
	"individual", // Persona individual
	"empresa_individual", // Empresa individual (comerciante)
	"sociedad_anonima", // S.A, Ltda, etc.
]);

// Vehicle Vendors table - Sellers of vehicles
export const vehicleVendors = pgTable("vehicle_vendors", {
	id: uuid("id").defaultRandom().primaryKey(),

	// Basic vendor info
	name: text("name").notNull(),
	phone: text("phone").notNull(),
	dpi: text("dpi").notNull().unique(),

	// Vendor type
	vendorType: text("vendor_type").notNull(), // 'individual' or 'empresa'

	// Company info (if empresa)
	companyName: text("company_name"), // Solo si es empresa

	// Contact details
	email: text("email"),
	address: text("address"),

	// General notes
	notes: text("notes"),

	// Timestamps
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Vehicles table
export const vehicles = pgTable("vehicles", {
	id: uuid("id").defaultRandom().primaryKey(),

	// Flag para vehículos nuevos (no requieren inspección, datos pueden completarse después)
	isNew: boolean("is_new").notNull().default(false),

	// Basic vehicle info (siempre requeridos - conocidos desde proforma)
	make: text("make").notNull(),
	model: text("model").notNull(),
	year: integer("year").notNull(),
	color: text("color").notNull(),
	vehicleType: text("vehicle_type").notNull(), // Sedan, SUV, Pickup, etc.

	// Identificación del vehículo (opcionales para nuevos - llegan después del dealer)
	licensePlate: text("license_plate").unique(), // Opcional para nuevos
	vinNumber: text("vin_number").unique(), // Opcional para nuevos
	motorNumber: text("motor_number"), // Número de motor

	// Campos adicionales para contratos legales
	seats: integer("seats"), // Número de asientos
	doors: integer("doors"), // Número de puertas
	axles: integer("axles").default(2), // Número de ejes (default 2)
	vehicleUse: text("vehicle_use"), // 'Particular' | 'Comercial'
	series: text("series"), // Serie del vehículo
	iscvCode: text("iscv_code"), // Código ISCV

	// Technical details (opcionales para nuevos)
	milesMileage: integer("miles_mileage"),
	kmMileage: integer("km_mileage").default(0), // Default 0 para nuevos
	origin: text("origin"), // Opcional para nuevos
	cylinders: text("cylinders"), // Opcional para nuevos
	engineCC: text("engine_cc"), // Opcional para nuevos
	fuelType: text("fuel_type"), // Opcional para nuevos
	transmission: text("transmission"), // Opcional para nuevos
	trim: text("trim"), // Versión o Equipamiento (ej. Touring)
	traction: text("traction"), // FWD, 4x4

	// Status
	status: vehicleStatusEnum("status").notNull().default("pending"),

	// Owner type - determines document requirements for analysis
	ownerType: vehicleOwnerTypeEnum("owner_type").notNull().default("individual"),

	// Company relationship
	companyId: uuid("company_id").references(() => companies.id),

	// Vendor relationship
	vendorId: uuid("vendor_id").references(() => vehicleVendors.id),

	// GPS Information
	gpsActivo: boolean("gps_activo").notNull().default(false),
	dispositivoGPS: text("dispositivo_gps"), // Marca/modelo del dispositivo GPS
	imeiGPS: text("imei_gps"), // IMEI único del dispositivo
	ubicacionActualGPS: text("ubicacion_actual_gps"), // JSON con coordenadas actuales
	ultimaSeñalGPS: timestamp("ultima_señal_gps"),

	// Insurance Information
	seguroVigente: boolean("seguro_vigente").notNull().default(false),
	numeroPoliza: text("numero_poliza"),
	companiaSeguro: text("compania_seguro"),
	fechaInicioSeguro: timestamp("fecha_inicio_seguro"),
	fechaVencimientoSeguro: timestamp("fecha_vencimiento_seguro"),
	montoAsegurado: decimal("monto_asegurado", { precision: 12, scale: 2 }),
	deducible: decimal("deducible", { precision: 12, scale: 2 }),
	tipoCobertura: text("tipo_cobertura"), // "basica", "amplia", "total"

	// General notes
	notes: text("notes"),

	// Timestamps
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Vehicle Inspections table
export const vehicleInspections = pgTable("vehicle_inspections", {
	id: uuid("id").defaultRandom().primaryKey(),
	vehicleId: uuid("vehicle_id")
		.references(() => vehicles.id)
		.notNull(),

	// Inspector info
	technicianName: text("technician_name").notNull(),
	inspectionDate: timestamp("inspection_date").notNull(),

	// Inspection result
	inspectionResult: text("inspection_result").notNull(),

	// Vehicle rating and values
	vehicleRating: text("vehicle_rating").notNull(), // Comercial, No comercial
	marketValue: decimal("market_value", { precision: 12, scale: 2 }).notNull(),
	suggestedCommercialValue: decimal("suggested_commercial_value", {
		precision: 12,
		scale: 2,
	}).notNull(),
	bankValue: decimal("bank_value", { precision: 12, scale: 2 }).notNull(),
	currentConditionValue: decimal("current_condition_value", {
		precision: 12,
		scale: 2,
	}).notNull(),

	// Detailed Conditions (Resumen final de la inspección)
	tiresCondition: integer("tires_condition"), // Vida útil neumáticos % (Promedio)
	// tireConditionFrontLeft: integer("tire_condition_front_left"),
	// tireConditionFrontRight: integer("tire_condition_front_right"),
	// tireConditionRearLeft: integer("tire_condition_rear_left"),
	// tireConditionRearRight: integer("tire_condition_rear_right"),
	// hasSpareTire: boolean("has_spare_tire").default(false),
	// tireConditionSpare: integer("tire_condition_spare"),
	// paintCondition: integer("paint_condition"), // Estado pintura %
	// hasAgencyHistory: boolean("has_agency_history"), // Historial agencia

	// AI Valuation Results (Persistencia de lo que recomendó la IA)
	// aiSuggestedValue: decimal("ai_suggested_value", { precision: 12, scale: 2 }),
	// aiMarketAnalysis: text("ai_market_analysis"),
	// aiDepreciationFactors: json("ai_depreciation_factors"),
	// aiConfidence: text("ai_confidence"),
	// aiCommercialClassification: text("ai_commercial_classification"),
	// aiReasoning: text("ai_reasoning"),

	// Equipment and considerations
	vehicleEquipment: text("vehicle_equipment").notNull(),
	importantConsiderations: text("important_considerations"),

	// Scanner and airbag info
	scannerUsed: boolean("scanner_used").notNull().default(false),
	scannerResultUrl: text("scanner_result_url"),
	airbagWarning: boolean("airbag_warning").notNull().default(false),
	missingAirbag: text("missing_airbag"),

	// Test drive
	testDrive: boolean("test_drive").notNull().default(false),
	noTestDriveReason: text("no_test_drive_reason"),

	// Approval status
	status: inspectionStatusEnum("status").notNull().default("pending"),

	// Alerts (stored as JSON array)
	alerts: json("alerts").$type<string[]>().default([]),

	// Evidence for rejection (New Feature)
	rejectionEvidenceUrl: text("rejection_evidence_url"), // Foto/Video general del rechazo

	// Section times (tiempo en segundos por sección del checklist)
	sectionTimes: json("section_times")
		.$type<Record<string, number>>()
		.default({}),

	// Timestamps
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Vehicle Photos table
export const vehiclePhotos = pgTable("vehicle_photos", {
	id: uuid("id").defaultRandom().primaryKey(),
	vehicleId: uuid("vehicle_id")
		.references(() => vehicles.id)
		.notNull(),
	inspectionId: uuid("inspection_id").references(() => vehicleInspections.id),

	category: text("category").notNull(), // exterior, wheels, interior, engine, damage
	photoType: text("photo_type").notNull(), // front-view, rear-view, etc.
	title: text("title").notNull(),
	description: text("description"),
	url: text("url").notNull(),

	// Valuator comments and verification
	valuatorComment: text("valuator_comment"), // Comentario del valuador sobre la foto
	noCommentsChecked: boolean("no_comments_checked").notNull().default(false), // Checkbox "Sin comentarios"

	createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Inspection Checklist Items table - for critical criteria evaluation
export const inspectionChecklistItems = pgTable("inspection_checklist_items", {
	id: uuid("id").defaultRandom().primaryKey(),
	inspectionId: uuid("inspection_id")
		.references(() => vehicleInspections.id)
		.notNull(),

	category: text("category").notNull(), // motor, transmision, suspension, etc.
	item: text("item").notNull(), // description of the criterion
	checked: boolean("checked").notNull().default(false),
	severity: text("severity").notNull().default("critical"), // critical, warning, info
	notes: text("notes"), // Optional notes for the item (e.g. for "Otros")

	createdAt: timestamp("created_at").defaultNow().notNull(),
});

/**
 * Table: checklist_item_evidence
 * Stores multimedia evidence (photos/videos) linked to checklist items.
 * Uses a cascade deletion strategy ensuring evidence is removed if the root checklist point is deleted.
 */
export const checklistItemEvidence = pgTable("checklist_item_evidence", {
	id: uuid("id").defaultRandom().primaryKey(),
	itemId: uuid("item_id")
		.references(() => inspectionChecklistItems.id, { onDelete: "cascade" })
		.notNull(),

	url: text("url").notNull(),
	mimeType: text("mime_type").notNull(),
	originalName: text("original_name").notNull(),

	createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Vehicle Documents table - Documents specific to vehicles (registration, title, etc.)
export const vehicleDocuments = pgTable("vehicle_documents", {
	id: uuid("id").defaultRandom().primaryKey(),
	vehicleId: uuid("vehicle_id")
		.references(() => vehicles.id, { onDelete: "cascade" })
		.notNull(),

	// File information
	filename: text("filename").notNull(), // Generated unique filename
	originalName: text("original_name").notNull(), // Original filename from user
	mimeType: text("mime_type").notNull(),
	size: integer("size").notNull(), // File size in bytes

	// Document classification - will reference documentType enum from documents.ts
	documentType: text("document_type").notNull(),

	// Storage location
	filePath: text("file_path").notNull(), // Path in R2 storage

	// Optional metadata
	description: text("description"),

	// Audit fields
	uploadedBy: text("uploaded_by").notNull(), // User who uploaded
	uploadedAt: timestamp("uploaded_at").defaultNow().notNull(),
});

// New Table for 360 Inspection Items (Excel Detailed List)
export const vehicleInspection360Items = pgTable(
	"vehicle_inspection_360_items",
	{
		id: uuid("id").defaultRandom().primaryKey(),
		inspectionId: uuid("inspection_id")
			.references(() => vehicleInspections.id)
			.notNull(),

		area: text("area").notNull(), // "Motor y Transmisión", "Frenos"...
		checkpoint: text("checkpoint").notNull(), // "Verificar fugas...", "Nivel de aceite..."

		status: inspection360StatusEnum("status").notNull(), // "ok", "bad", "na", "bueno", "regular", "malo"
		comment: text("comment"), // Obligatorio si status="bad"
		metadata: json("metadata").$type<Record<string, any>>(),

		createdAt: timestamp("created_at").defaultNow().notNull(),
		updatedAt: timestamp("updated_at"),
	},
);

// Vehicle Document Requirements table - Defines which documents are required per owner type
export const vehicleDocumentRequirements = pgTable(
	"vehicle_document_requirements",
	{
		id: uuid("id").defaultRandom().primaryKey(),

		// Owner type this requirement applies to
		ownerType: vehicleOwnerTypeEnum("owner_type").notNull(),

		// Document type required
		documentType: text("document_type").notNull(),

		// Whether this document is mandatory
		required: boolean("required").notNull().default(true),

		// Display order in UI
		order: integer("order").notNull().default(0),

		// Timestamps
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
);

// Relations
export const vehicleVendorsRelations = relations(
	vehicleVendors,
	({ many }) => ({
		vehicles: many(vehicles),
	}),
);

export const vehiclesRelations = relations(vehicles, ({ many, one }) => ({
	inspections: many(vehicleInspections),
	photos: many(vehiclePhotos),
	documents: many(vehicleDocuments),
	company: one(companies, {
		fields: [vehicles.companyId],
		references: [companies.id],
	}),
	vendor: one(vehicleVendors, {
		fields: [vehicles.vendorId],
		references: [vehicleVendors.id],
	}),
}));

export const vehicleInspectionsRelations = relations(
	vehicleInspections,
	({ one, many }) => ({
		vehicle: one(vehicles, {
			fields: [vehicleInspections.vehicleId],
			references: [vehicles.id],
		}),
		photos: many(vehiclePhotos),
		checklistItems: many(inspectionChecklistItems),
		inspection360Items: many(vehicleInspection360Items),
	}),
);

export const vehiclePhotosRelations = relations(vehiclePhotos, ({ one }) => ({
	vehicle: one(vehicles, {
		fields: [vehiclePhotos.vehicleId],
		references: [vehicles.id],
	}),
	inspection: one(vehicleInspections, {
		fields: [vehiclePhotos.inspectionId],
		references: [vehicleInspections.id],
	}),
}));

export const inspectionChecklistItemsRelations = relations(
	inspectionChecklistItems,
	({ one, many }) => ({
		inspection: one(vehicleInspections, {
			fields: [inspectionChecklistItems.inspectionId],
			references: [vehicleInspections.id],
		}),
		evidence: many(checklistItemEvidence),
	}),
);

export const checklistItemEvidenceRelations = relations(
	checklistItemEvidence,
	({ one }) => ({
		item: one(inspectionChecklistItems, {
			fields: [checklistItemEvidence.itemId],
			references: [inspectionChecklistItems.id],
		}),
	}),
);

export const vehicleDocumentsRelations = relations(
	vehicleDocuments,
	({ one }) => ({
		vehicle: one(vehicles, {
			fields: [vehicleDocuments.vehicleId],
			references: [vehicles.id],
		}),
	}),
);

export const vehicleInspection360ItemsRelations = relations(
	vehicleInspection360Items,
	({ one }) => ({
		inspection: one(vehicleInspections, {
			fields: [vehicleInspection360Items.inspectionId],
			references: [vehicleInspections.id],
		}),
	}),
);

// Export types for TypeScript
export type VehicleVendor = typeof vehicleVendors.$inferSelect;
export type NewVehicleVendor = typeof vehicleVendors.$inferInsert;

export type Vehicle = typeof vehicles.$inferSelect;
export type NewVehicle = typeof vehicles.$inferInsert;

export type VehicleInspection = typeof vehicleInspections.$inferSelect;
export type NewVehicleInspection = typeof vehicleInspections.$inferInsert;

export type VehiclePhoto = typeof vehiclePhotos.$inferSelect;
export type NewVehiclePhoto = typeof vehiclePhotos.$inferInsert;

export type InspectionChecklistItem =
	typeof inspectionChecklistItems.$inferSelect;
export type NewInspectionChecklistItem =
	typeof inspectionChecklistItems.$inferInsert;

export type ChecklistItemEvidence = typeof checklistItemEvidence.$inferSelect;
export type NewChecklistItemEvidence =
	typeof checklistItemEvidence.$inferInsert;

export type VehicleInspection360Item =
	typeof vehicleInspection360Items.$inferSelect;
export type NewVehicleInspection360Item =
	typeof vehicleInspection360Items.$inferInsert;

export type VehicleDocument = typeof vehicleDocuments.$inferSelect;
export type NewVehicleDocument = typeof vehicleDocuments.$inferInsert;

export type VehicleDocumentRequirement =
	typeof vehicleDocumentRequirements.$inferSelect;
export type NewVehicleDocumentRequirement =
	typeof vehicleDocumentRequirements.$inferInsert;
