import {
	boolean,
	decimal,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

// Enums
export const leadStatusEnum = pgEnum("lead_status", [
	"new",
	"contacted",
	"qualified",
	"unqualified",
	"converted",
]);
export const leadSourceEnum = pgEnum("lead_source", [
	"website",
	"referral",
	"cold_call",
	"email",
	"social_media",
	"event",
	"other",
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
	"1_to_5",
	"5_to_10",
	"10_plus",
]);
export const loanPurposeEnum = pgEnum("loan_purpose", ["personal", "business"]);
export const opportunityStatusEnum = pgEnum("opportunity_status", [
	"open",
	"won",
	"lost",
	"on_hold",
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
	lastName: text("last_name").notNull(),
	email: text("email").notNull(),
	phone: text("phone").notNull(),
	age: integer("age"),
	dpi: text("dpi"),
	maritalStatus: maritalStatusEnum("marital_status"),
	dependents: integer("dependents").default(0),
	monthlyIncome: decimal("monthly_income", { precision: 12, scale: 2 }),
	loanAmount: decimal("loan_amount", { precision: 12, scale: 2 }),
	occupation: occupationTypeEnum("occupation"),
	workTime: workTimeEnum("work_time"),
	loanPurpose: loanPurposeEnum("loan_purpose"),
	ownsHome: boolean("owns_home").default(false),
	ownsVehicle: boolean("owns_vehicle").default(false),
	hasCreditCard: boolean("has_credit_card").default(false),
	jobTitle: text("job_title"),
	companyId: uuid("company_id").references(() => companies.id),
	source: leadSourceEnum("source").notNull().default("other"),
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
	createdBy: text("created_by")
		.notNull()
		.references(() => user.id),
});

// Credit Analysis table - Análisis de capacidad de pago
export const creditAnalysis = pgTable("credit_analysis", {
	id: uuid("id").primaryKey().defaultRandom(),
	leadId: uuid("lead_id")
		.notNull()
		.references(() => leads.id)
		.unique(),
	// Resumen de análisis completo (JSON)
	fullAnalysis: text("full_analysis"), // JSON string with complete bank analysis
	// Promedios mensuales
	monthlyFixedIncome: decimal("monthly_fixed_income", { precision: 12, scale: 2 }),
	monthlyVariableIncome: decimal("monthly_variable_income", { precision: 12, scale: 2 }),
	monthlyFixedExpenses: decimal("monthly_fixed_expenses", { precision: 12, scale: 2 }),
	monthlyVariableExpenses: decimal("monthly_variable_expenses", { precision: 12, scale: 2 }),
	economicAvailability: decimal("economic_availability", { precision: 12, scale: 2 }),
	// Cálculos de capacidad de pago
	minPayment: decimal("min_payment", { precision: 12, scale: 2 }),
	maxPayment: decimal("max_payment", { precision: 12, scale: 2 }),
	adjustedPayment: decimal("adjusted_payment", { precision: 12, scale: 2 }),
	maxCreditAmount: decimal("max_credit_amount", { precision: 12, scale: 2 }),
	// Metadata
	analyzedAt: timestamp("analyzed_at").notNull().defaultNow(),
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
	companyId: uuid("company_id")
		.notNull()
		.references(() => companies.id),
	opportunityId: uuid("opportunity_id").references(() => opportunities.id),
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
