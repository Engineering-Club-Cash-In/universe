import {
	boolean,
	date,
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

// ============ ENUMS ============

export const investmentLeadSourceEnum = pgEnum("investment_lead_source", [
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
	"whatsapp",
]);

export const investmentStageEnum = pgEnum("investment_stage", [
	"prospecting",
	"contacted",
	"negotiation",
	"acceptance_signatures",
	"welcome",
	"closed",
	"lost",
]);

export const investmentOpportunityStatusEnum = pgEnum(
	"investment_opportunity_status",
	["open", "won", "lost"],
);

export const investorClientTypeEnum = pgEnum("investor_client_type", [
	"individual",
	"empresa_individual",
	"sociedad_anonima",
]);

export const investorStatusEnum = pgEnum("investor_status", [
	"active",
	"inactive",
]);

export const investmentModalityEnum = pgEnum("investment_modality", [
	"traditional",
	"maturity",
	"compound",
]);

export const investmentDocumentTypeEnum = pgEnum("investment_document_type", [
	"dpi_front",
	"dpi_back",
	"income_form",
	"fund_declaration",
	"utility_bill",
	"bank_statement",
	"investment_receipt",
	"other",
	"contract",
]);

export const investmentDocumentStatusEnum = pgEnum(
	"investment_document_status",
	["pending", "approved", "rejected"],
);

export const investmentInteractionTypeEnum = pgEnum(
	"investment_interaction_type",
	["call", "email", "whatsapp", "meeting"],
);

export const investmentScenarioSentViaEnum = pgEnum(
	"investment_scenario_sent_via",
	["email", "whatsapp", "portal"],
);

// ============ TABLES ============

// --- Investment Leads ---
export const investmentLeads = pgTable("investment_leads", {
	id: uuid("id").primaryKey().defaultRandom(),
	name: text("name").notNull(),
	email: text("email"),
	phones: text("phones").array(),
	source: investmentLeadSourceEnum("source"),
	campaign: text("campaign"),
	proposedAmount: decimal("proposed_amount", { precision: 16, scale: 2 }),
	assignedTo: text("assigned_to").references(() => user.id),
	userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
	companyName: text("company_name"),
	dpi: text("dpi"),
	investmentExperience: text("investment_experience"),
	notes: text("notes"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// --- Investors (perfil completo) ---
export const investors = pgTable("investors", {
	id: uuid("id").primaryKey().defaultRandom(),
	investmentLeadId: uuid("investment_lead_id").references(
		() => investmentLeads.id,
		{ onDelete: "set null" },
	),
	userId: text("user_id").references(() => user.id, { onDelete: "set null" }),
	carteraBackInvestorId: integer("cartera_back_investor_id"),
	// Tipo y datos
	clientType: investorClientTypeEnum("client_type")
		.notNull()
		.default("individual"),
	firstName: text("first_name").notNull(),
	lastName: text("last_name").notNull(),
	nit: text("nit"),
	billingName: text("billing_name"),
	corporation: text("corporation"),
	legalRepresentative: text("legal_representative"),
	paymentChannel: text("payment_channel"),
	status: investorStatusEnum("status").notNull().default("active"),
	// Contacto
	phones: text("phones").array(),
	email: text("email"),
	website: text("website"),
	address: text("address"),
	// Notas
	notes: text("notes"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// --- Investment Opportunities (Pipeline) ---
export const investmentOpportunities = pgTable("investment_opportunities", {
	id: uuid("id").primaryKey().defaultRandom(),
	investmentLeadId: uuid("investment_lead_id")
		.notNull()
		.references(() => investmentLeads.id, { onDelete: "cascade" }),
	investorId: uuid("investor_id").references(() => investors.id, {
		onDelete: "set null",
	}),
	stage: investmentStageEnum("stage").notNull().default("prospecting"),
	assignedAdvisorId: text("assigned_advisor_id")
		.notNull()
		.references(() => user.id),
	status: investmentOpportunityStatusEnum("status").notNull().default("open"),
	// Perdido
	lostReason: text("lost_reason"),
	lastStageBeforeLost: investmentStageEnum("last_stage_before_lost"),
	// Timestamp de etapa actual
	stageEnteredAt: timestamp("stage_entered_at").notNull().defaultNow(),
	// Checklist de negociacion
	scenariosCompleted: boolean("scenarios_completed").notNull().default(false),
	documentsApproved: boolean("documents_approved").notNull().default(false),
	kycCompleted: boolean("kyc_completed").notNull().default(false),
	profileCompleted: boolean("profile_completed").notNull().default(false),
	webappProfileCreated: boolean("webapp_profile_created")
		.notNull()
		.default(false),
	// Firmas
	signaturesCompleted: integer("signatures_completed").notNull().default(0),
	signaturesTotal: integer("signatures_total").notNull().default(4),
	// Validacion de fondos
	fundsValidated: boolean("funds_validated").notNull().default(false),
	fundsValidatedBy: text("funds_validated_by").references(() => user.id),
	fundsValidatedAt: timestamp("funds_validated_at"),
	// Timestamps
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// --- Investment Scenarios (Cotizaciones) ---
export const investmentScenarios = pgTable("investment_scenarios", {
	id: uuid("id").primaryKey().defaultRandom(),
	investmentOpportunityId: uuid("investment_opportunity_id")
		.notNull()
		.references(() => investmentOpportunities.id, { onDelete: "cascade" }),
	// Inputs
	amount: decimal("amount", { precision: 16, scale: 2 }).notNull(),
	monthlyRate: decimal("monthly_rate", { precision: 12, scale: 8 }).notNull(),
	termMonths: integer("term_months").notNull(),
	modality: investmentModalityEnum("modality").notNull(),
	isSmallTaxpayer: boolean("is_small_taxpayer").notNull().default(false),
	// Outputs calculados
	totalInterest: decimal("total_interest", { precision: 16, scale: 2 }),
	totalToReceive: decimal("total_to_receive", { precision: 16, scale: 2 }),
	amortizationTable: jsonb("amortization_table"),
	// Estado
	isAccepted: boolean("is_accepted").notNull().default(false),
	pdfUrl: text("pdf_url"),
	sentAt: timestamp("sent_at"),
	sentVia: investmentScenarioSentViaEnum("sent_via"),
	// Timestamps
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

// --- Investment Documents ---
export const investmentDocuments = pgTable("investment_documents", {
	id: uuid("id").primaryKey().defaultRandom(),
	investorId: uuid("investor_id")
		.notNull()
		.references(() => investors.id, { onDelete: "cascade" }),
	investmentOpportunityId: uuid("investment_opportunity_id")
		.notNull()
		.references(() => investmentOpportunities.id, { onDelete: "cascade" }),
	documentType: investmentDocumentTypeEnum("document_type").notNull(),
	fileUrl: text("file_url").notNull(),
	fileName: text("file_name"),
	mimeType: text("mime_type"),
	status: investmentDocumentStatusEnum("status").notNull().default("pending"),
	reviewedBy: text("reviewed_by").references(() => user.id),
	reviewedAt: timestamp("reviewed_at"),
	rejectionReason: text("rejection_reason"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

// --- Investment Interactions ---
export const investmentInteractions = pgTable("investment_interactions", {
	id: uuid("id").primaryKey().defaultRandom(),
	investmentOpportunityId: uuid("investment_opportunity_id")
		.notNull()
		.references(() => investmentOpportunities.id, { onDelete: "cascade" }),
	interactionType: investmentInteractionTypeEnum("interaction_type").notNull(),
	date: date("date").notNull(),
	time: text("time"),
	description: text("description").notNull(),
	nextFollowupDate: timestamp("next_followup_date"),
	createdBy: text("created_by")
		.notNull()
		.references(() => user.id),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

// --- Investment Stage History (Auditoria de movimientos) ---
export const investmentStageHistory = pgTable("investment_stage_history", {
	id: uuid("id").primaryKey().defaultRandom(),
	investmentOpportunityId: uuid("investment_opportunity_id")
		.notNull()
		.references(() => investmentOpportunities.id, { onDelete: "cascade" }),
	fromStage: investmentStageEnum("from_stage"),
	toStage: investmentStageEnum("to_stage").notNull(),
	changedBy: text("changed_by")
		.notNull()
		.references(() => user.id),
	reason: text("reason"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

// --- Investment Audit Log (todas las acciones) ---
export const investmentAuditLog = pgTable("investment_audit_log", {
	id: uuid("id").primaryKey().defaultRandom(),
	investmentOpportunityId: uuid("investment_opportunity_id").references(
		() => investmentOpportunities.id,
		{ onDelete: "cascade" },
	),
	investorId: uuid("investor_id").references(() => investors.id, {
		onDelete: "cascade",
	}),
	action: text("action").notNull(),
	details: jsonb("details"),
	performedBy: text("performed_by")
		.notNull()
		.references(() => user.id),
	createdAt: timestamp("created_at").notNull().defaultNow(),
});

// --- Investment Non-Advance Survey ---
export const investmentNonAdvanceSurvey = pgTable(
	"investment_non_advance_survey",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		investmentOpportunityId: uuid("investment_opportunity_id")
			.notNull()
			.references(() => investmentOpportunities.id, { onDelete: "cascade" }),
		reason: text("reason").notNull(),
		additionalComments: text("additional_comments"),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
);
