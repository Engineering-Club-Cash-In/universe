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
	phone: text("phone"),
	jobTitle: text("job_title"),
	companyId: uuid("company_id").references(() => companies.id),
	source: leadSourceEnum("source").notNull().default("other"),
	status: leadStatusEnum("status").notNull().default("new"),
	assignedTo: text("assigned_to")
		.notNull()
		.references(() => user.id),
	notes: text("notes"),
	convertedAt: timestamp("converted_at"),
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
