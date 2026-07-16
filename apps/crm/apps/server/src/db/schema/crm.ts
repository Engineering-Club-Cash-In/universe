import {
	boolean,
	decimal,
	integer,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { vehicles } from "./vehicles";

// Enums
export const leadStatusEnum = pgEnum("lead_status", [
	"new",
	"contacted",
	"qualified",
	"unqualified",
	"converted",
	"migrate", // Leads cargados por migración masiva (no pasaron por el proceso normal)
]);
export const leadSourceEnum = pgEnum("lead_source", [
	"website",
	"referral",
	"cold_call",
	"email",
	"social_media",
	"event",
	"other",
	"facebook",
	"instagram",
	"google",
	"meta",
	"linkedin",
	"Whatsapp",
	"agency",
	"property",
	"recurrent",
	"recurrent_active",
]);
export const maritalStatusEnum = pgEnum("marital_status", [
	"single",
	"married",
	"divorced",
	"widowed",
]);
export const occupationTypeEnum = pgEnum("occupation_type", [
	"owner",
	"employee",
]);
export const workTimeEnum = pgEnum("work_time", [
	"less_than_1",
	"1_to_5",
	"5_to_10",
	"10_plus",
]);
export const loanPurposeEnum = pgEnum("loan_purpose", ["personal", "business"]);
export const creditTypeEnum = pgEnum("credit_type", [
	"autocompra",
	"sobre_vehiculo",
]);
export const assignmentTypeEnum = pgEnum("assignment_type", ["auto", "manual"]);
export const creditCategoryEnum = pgEnum("credit_category", [
	"Contraseña",
	"CV Vehículo",
	"CV Vehículo nuevo",
	"Fiduciario",
	"Hipotecario",
	"Vehículo",
]);
export const opportunityStatusEnum = pgEnum("opportunity_status", [
	"open",
	"won",
	"lost",
	"on_hold",
	"migrate", // Créditos cargados por migración masiva (no pasaron por el proceso normal)
]);
export const clientStatusEnum = pgEnum("client_status", [
	"active",
	"inactive",
	"churned",
]);
export const activityTypeEnum = pgEnum("activity_type", [
	"call",
	"email",
	"meeting",
	"task",
	"note",
]);
export const activityStatusEnum = pgEnum("activity_status", [
	"pending",
	"completed",
	"cancelled",
]);
export const clientTypeEnum = pgEnum("client_type", [
	"individual", // Cliente individual
	"comerciante", // Comerciante individual
	"empresa", // Empresa (S.A, Ltda, etc.)
]);

// Analysis status enum for tracking opportunity analysis workflow
export const analysisStatusEnum = pgEnum("analysis_status", [
	"not_applicable", // Nunca ha llegado a análisis (etapa < 30%)
	"pending", // Primera vez en 30%, esperando revisión
	"rejected", // Rechazada, en etapa < 30% esperando corrección
	"resubmitted", // Corregida y reenviada a 30%
	"approved", // Aprobada, pasó a 40%+
]);

// Companies table
export const companies = pgTable("companies", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: text("name").notNull(),
	industry: text("industry"),
	size: text("size"), // Small, Medium, Large, Enterprise
	website: text("website"),
	address: text("address"),
	phone: text("phone"),
	email: text("email"),
	notes: text("notes"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
	createdBy: text("created_by")
		.notNull()
		.references(() => user.id),
});

// Sales stages table (the 9 pipeline stages)
export const salesStages = pgTable("sales_stages", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: text("name").notNull(),
	order: integer("order").notNull(),
	closurePercentage: integer("closure_percentage").notNull(),
	color: text("color").notNull(), // CSS color for UI
	description: text("description"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Leads table
export const leads = pgTable("leads", {
	id: uuid("id").primaryKey().defaultRandom(),
	firstName: text("first_name").notNull(),
	middleName: text("middle_name"), // Segundo nombre
	lastName: text("last_name").notNull(),
	secondLastName: text("second_last_name"), // Segundo apellido
	email: text("email"),
	phone: text("phone"),
	age: integer("age"),
	dpi: text("dpi"),
	nit: text("nit"), // Tax identification number
	direccion: text("direccion"),
	departamento: text("departamento"), // Departamento de Guatemala
	municipio: text("municipio"), // Municipio
	zona: text("zona"), // Zona
	clientType: clientTypeEnum("client_type").notNull().default("individual"),
	maritalStatus: maritalStatusEnum("marital_status"),
	// Campos adicionales para contratos legales
	birthDate: timestamp("birth_date"), // Fecha de nacimiento (para calcular edad)
	gender: text("gender"), // 'male' | 'female'
	nationality: text("nationality"), // Nacionalidad (ej: "guatemalteco")
	dependents: integer("dependents").default(0),
	monthlyIncome: decimal("monthly_income", { precision: 12, scale: 2 }),
	loanAmount: decimal("loan_amount", { precision: 12, scale: 2 }),
	occupation: occupationTypeEnum("occupation"),
	workTime: workTimeEnum("work_time"),
	ownsHome: boolean("owns_home").default(false),
	ownsVehicle: boolean("owns_vehicle").default(false),
	hasCreditCard: boolean("has_credit_card").default(false),
	jobTitle: text("job_title"),
	companyId: uuid("company_id").references(() => companies.id),
	source: leadSourceEnum("source").notNull().default("other"),
	campaign: text("campaign"),
	status: leadStatusEnum("status").notNull().default("new"),
	assignedTo: text("assigned_to")
		.notNull()
		.references(() => user.id),
	notes: text("notes"),
	convertedAt: timestamp("converted_at"),
	score: decimal("score", { precision: 3, scale: 2 }),
	fit: boolean("fit").default(false),
	scoredAt: timestamp("scored_at"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
	livenessValidated: boolean("liveness_validated").notNull().default(false),
	assignmentType: assignmentTypeEnum("assignment_type")
		.notNull()
		.default("manual"),
	createdBy: text("created_by")
		.notNull()
		.references(() => user.id),
});
export const magicUrls = pgTable("magic_urls", {
	id: uuid("id").primaryKey().defaultRandom(), // identificador único del link
	leadId: uuid("lead_id")
		.notNull()
		.references(() => leads.id), // relación con leads
	url: text("url").notNull(), // link mágico generado
	createdAt: timestamp("created_at").notNull().defaultNow(), // fecha de creación
	updatedAt: timestamp("updated_at").notNull().defaultNow(), // fecha de última actualización|
	expiresAt: timestamp("expires_at").notNull(), // expiración del link
	used: boolean("used").notNull().default(false), // si ya fue usado
});
// LegalDocuments table
export const legalDocuments = pgTable("legal_documents", {
	id: uuid("id").primaryKey().defaultRandom(),
	leadId: uuid("lead_id")
		.notNull()
		.references(() => leads.id, { onDelete: "cascade" }), // relación con leads

	electricityBill: text("electricity_bill"), // recibo de luz
	bankStatements: text("bank_statements"), // estados de cuenta
	bankStatements2: text("bank_statements_2"), // estados de cuenta
	bankStatements3: text("bank_statements_3"), // estados de cuenta

	createdAt: timestamp("created_at").notNull().defaultNow(),
});
// Co-debtors table - Co-deudores/Co-firmantes de oportunidades
export const coDebtors = pgTable("co_debtors", {
	id: uuid("id").primaryKey().defaultRandom(),
	opportunityId: uuid("opportunity_id")
		.notNull()
		.references(() => opportunities.id, { onDelete: "cascade" }),
	fullName: text("full_name").notNull(), // Nombre completo
	dpi: text("dpi").notNull(), // DPI
	age: integer("age"), // Edad
	gender: text("gender"), // Género ('male' | 'female')
	maritalStatus: maritalStatusEnum("marital_status"), // Estado civil
	profession: text("profession"), // Profesión
	nationality: text("nationality"), // Nacionalidad
	email: text("email"), // Correo electrónico
	phone: text("phone"), // Número de teléfono
	occupation: occupationTypeEnum("occupation"), // Ocupación (owner/employee)
	notes: text("notes"), // Notas
	score: decimal("score", { precision: 3, scale: 2 }), // Score de crédito
	fit: boolean("fit").default(false), // Si califica
	scoredAt: timestamp("scored_at"), // Fecha de evaluación
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Credit Analysis table - Análisis de capacidad de pago
export const creditAnalysis = pgTable("credit_analysis", {
	id: uuid("id").primaryKey().defaultRandom(),
	// El análisis puede ser de un lead O de un co-deudor (uno de los dos debe estar presente)
	leadId: uuid("lead_id").references(() => leads.id),
	coDebtorId: uuid("co_debtor_id").references(() => coDebtors.id),
	// Resumen de análisis completo (JSON)
	fullAnalysis: text("full_analysis"), // JSON string with complete bank analysis
	// Promedios mensuales
	monthlyFixedIncome: decimal("monthly_fixed_income", {
		precision: 12,
		scale: 2,
	}),
	monthlyVariableIncome: decimal("monthly_variable_income", {
		precision: 12,
		scale: 2,
	}),
	monthlyFixedExpenses: decimal("monthly_fixed_expenses", {
		precision: 12,
		scale: 2,
	}),
	monthlyVariableExpenses: decimal("monthly_variable_expenses", {
		precision: 12,
		scale: 2,
	}),
	economicAvailability: decimal("economic_availability", {
		precision: 12,
		scale: 2,
	}),
	// Cálculos de capacidad de pago
	minPayment: decimal("min_payment", { precision: 12, scale: 2 }),
	maxPayment: decimal("max_payment", { precision: 12, scale: 2 }),
	adjustedPayment: decimal("adjusted_payment", { precision: 12, scale: 2 }),
	maxCreditAmount: decimal("max_credit_amount", { precision: 12, scale: 2 }),
	// Fecha ideal de pago sugerida por la IA (día del mes 1-31, según cuándo recibe ingresos)
	suggestedPaymentDay: integer("suggested_payment_day"),
	// Control de intentos de análisis con IA (cada llamada a IA cuesta dinero)
	attemptCount: integer("attempt_count").notNull().default(0), // Se incrementa al llamar a la IA
	// Metadata
	analyzedAt: timestamp("analyzed_at"), // null hasta que haya un análisis exitoso
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
	createdBy: text("created_by")
		.notNull()
		.references(() => user.id),
});

// Opportunities table
export const opportunities = pgTable("opportunities", {
	id: uuid("id").primaryKey().defaultRandom(),
	title: text("title").notNull(),
	leadId: uuid("lead_id").references(() => leads.id),
	companyId: uuid("company_id").references(() => companies.id),
	vehicleId: uuid("vehicle_id").references(() => vehicles.id), // Relación con vehículo (opcional)
	creditType: creditTypeEnum("credit_type").notNull().default("autocompra"),
	source: leadSourceEnum("source"), // Source of the opportunity (from lead or input)
	campaign: text("campaign"),
	loanPurpose: loanPurposeEnum("loan_purpose"), // Purpose of the loan (migrated from leads)
	value: decimal("value", { precision: 12, scale: 2 }),
	stageId: uuid("stage_id")
		.notNull()
		.references(() => salesStages.id),
	probability: integer("probability").notNull().default(0), // 0-100
	expectedCloseDate: timestamp("expected_close_date"),
	actualCloseDate: timestamp("actual_close_date"),
	status: opportunityStatusEnum("status").notNull().default("open"),
	assignedTo: text("assigned_to")
		.notNull()
		.references(() => user.id),

	// Vehicle vendor relationship
	vendorId: uuid("vendor_id"),

	// Credit terms - Required for creating financing contract at 100%
	numeroCuotas: integer("numero_cuotas"), // Loan term in months
	tasaInteres: decimal("tasa_interes", { precision: 5, scale: 2 }), // Annual interest rate
	cuotaMensual: decimal("cuota_mensual", { precision: 12, scale: 2 }), // Monthly payment amount
	fechaInicio: timestamp("fecha_inicio"), // Contract start date
	diaPagoMensual: integer("dia_pago_mensual"), // Payment day of month (1-31)

	// Additional fields
	seguro: decimal("seguro", { precision: 12, scale: 2 }), // Insurance amount
	gps: decimal("gps", { precision: 12, scale: 2 }), // GPS amount
	insuranceProvider: text("insurance_provider")
		.notNull()
		.default("universales"),
	customerInsuranceCost: decimal("customer_insurance_cost", {
		precision: 16,
		scale: 8,
	}),
	internalInsuranceCost: decimal("internal_insurance_cost", {
		precision: 16,
		scale: 8,
	}),
	insuranceSavingsToMembership: decimal("insurance_savings_to_membership", {
		precision: 16,
		scale: 8,
	})
		.notNull()
		.default("0"),
	categoria: creditCategoryEnum("categoria"), // Credit category
	nit: text("nit"), // Tax identification number
	royalti: decimal("royalti", { precision: 12, scale: 2 }), // Royalty amount
	porcentajeRoyalti: decimal("porcentaje_royalti", { precision: 5, scale: 2 }), // Royalty percentage
	reserva: decimal("reserva", { precision: 12, scale: 2 }), // Reserve amount
	membresiaPago: decimal("membresia_pago", { precision: 12, scale: 2 }), // Membership payment
	inversionistas: text("inversionistas"), // JSON string with investors data
	asesorId: integer("asesor_id"), // Advisor ID from cartera-back
	numeroSifco: text("numero_sifco"), // SIFCO credit number
	rubros: text("rubros"), // JSON string with expense items (rubros)
	gastosAdministrativos: decimal("gastos_administrativos", {
		precision: 12,
		scale: 2,
	}), // Administrative expenses (for "otros" in cartera-back)

	// Credit Detail Approval (40% → 50%)
	creditDetailApproved: boolean("credit_detail_approved").default(false),
	creditDetailApprovedBy: text("credit_detail_approved_by").references(
		() => user.id,
	),
	creditDetailApprovedAt: timestamp("credit_detail_approved_at"),

	// Disbursement Approval (90% → 100%)
	disbursementApproved: boolean("disbursement_approved").default(false),
	disbursementApprovedBy: text("disbursement_approved_by").references(
		() => user.id,
	),
	disbursementApprovedAt: timestamp("disbursement_approved_at"),

	// Analysis Status
	analysisStatus: analysisStatusEnum("analysis_status")
		.notNull()
		.default("not_applicable"),
	analysisRejectionCount: integer("analysis_rejection_count")
		.notNull()
		.default(0),
	lastAnalysisRejectedAt: timestamp("last_analysis_rejected_at"),
	lastAnalysisRejectedBy: text("last_analysis_rejected_by").references(
		() => user.id,
	),

	notes: text("notes"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
	createdBy: text("created_by")
		.notNull()
		.references(() => user.id),
});

// Clients table
export const clients = pgTable("clients", {
	id: uuid("id").primaryKey().defaultRandom(),
	companyId: uuid("company_id").references(() => companies.id),
	opportunityId: uuid("opportunity_id").references(() => opportunities.id),
	leadId: uuid("lead_id").references(() => leads.id),
	contactPerson: text("contact_person").notNull(),
	contractValue: decimal("contract_value", { precision: 12, scale: 2 }),
	startDate: timestamp("start_date"),
	endDate: timestamp("end_date"),
	status: clientStatusEnum("status").notNull().default("active"),
	assignedTo: text("assigned_to")
		.notNull()
		.references(() => user.id),
	notes: text("notes"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
	createdBy: text("created_by")
		.notNull()
		.references(() => user.id),
});

// Opportunity Stage History table - Tracks all stage movements
export const opportunityStageHistory = pgTable("opportunity_stage_history", {
	id: uuid("id").primaryKey().defaultRandom(),
	opportunityId: uuid("opportunity_id")
		.notNull()
		.references(() => opportunities.id, { onDelete: "cascade" }),
	fromStageId: uuid("from_stage_id").references(() => salesStages.id),
	toStageId: uuid("to_stage_id")
		.notNull()
		.references(() => salesStages.id),
	changedBy: text("changed_by")
		.notNull()
		.references(() => user.id),
	changedAt: timestamp("changed_at").notNull().defaultNow(),
	reason: text("reason"), // For tracking why the change was made
	isOverride: boolean("is_override").default(false), // True if sales overrode analyst decision
});

// Activities table
export const activities = pgTable("activities", {
	id: uuid("id").primaryKey().defaultRandom(),
	type: activityTypeEnum("type").notNull(),
	subject: text("subject").notNull(),
	description: text("description"),
	// Polymorphic relationship - can relate to leads, opportunities, or clients
	relatedToType: text("related_to_type").notNull(), // 'lead', 'opportunity', 'client'
	relatedToId: uuid("related_to_id").notNull(),
	assignedTo: text("assigned_to")
		.notNull()
		.references(() => user.id),
	dueDate: timestamp("due_date"),
	completedAt: timestamp("completed_at"),
	status: activityStatusEnum("status").notNull().default("pending"),
	notes: text("notes"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
	createdBy: text("created_by")
		.notNull()
		.references(() => user.id),
});

// Enum para parentesco de referencias
export const parentescoReferenciaEnum = pgEnum("parentesco_referencia", [
	"padre_madre",
	"hermano_a",
	"hijo_a",
	"conyuge",
	"tio_a",
	"primo_a",
	"amigo_a",
	"vecino_a",
	"companero_trabajo",
	"otro",
]);

/** Valores canónicos del enum de parentesco. Úsalo en lugar de duplicar el array. */
export const PARENTESCO_VALUES = parentescoReferenciaEnum.enumValues;

// Audit log for deleted opportunities
export const deletedOpportunityLogs = pgTable("deleted_opportunity_logs", {
	id: uuid("id").primaryKey().defaultRandom(),
	// Snapshot of opportunity data (no FKs — records may no longer exist)
	opportunityId: uuid("opportunity_id").notNull(),
	opportunityTitle: text("opportunity_title").notNull(),
	opportunityValue: decimal("opportunity_value", { precision: 12, scale: 2 }),
	opportunityStatus: text("opportunity_status").notNull(),
	opportunityStageName: text("opportunity_stage_name"),
	opportunityStagePercentage: integer("opportunity_stage_percentage"),
	opportunityCreatedAt: timestamp("opportunity_created_at").notNull(),
	// Assigned salesperson snapshot
	assignedUserId: text("assigned_user_id"),
	assignedUserName: text("assigned_user_name"),
	// Lead snapshot
	leadId: uuid("lead_id"),
	leadName: text("lead_name"),
	// Deletion metadata (all plain text — no FKs to avoid future constraint issues)
	deletedBy: text("deleted_by").notNull(),
	deletedByName: text("deleted_by_name").notNull(),
	deletedAt: timestamp("deleted_at").notNull().defaultNow(),
	reason: text("reason").notNull(),
	snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
});

// Referencias de un lead (personas de contacto: familiares, amigos, etc.)
export const referenciasLead = pgTable("referencias_lead", {
	id: uuid("id").primaryKey().defaultRandom(),
	leadId: uuid("lead_id")
		.notNull()
		.references(() => leads.id, { onDelete: "cascade" }),
	nombre: text("nombre").notNull(),
	telefono: text("telefono").notNull(),
	parentesco: parentescoReferenciaEnum("parentesco").notNull(),
	notas: text("notas"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
