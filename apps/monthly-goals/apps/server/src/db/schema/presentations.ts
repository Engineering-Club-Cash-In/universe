import { check, pgTable, text, timestamp, uuid, integer, pgEnum, decimal } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { monthlyGoals } from "./monthly-goals";
import { sql } from "drizzle-orm";

export const presentationStatusEnum = pgEnum("presentation_status", ["draft", "ready", "presented"]);

export const presentations = pgTable("presentations", {
	id: uuid("id").defaultRandom().primaryKey(),
	name: text("name").notNull(),
	startMonth: integer("start_month").notNull(),
	startYear: integer("start_year").notNull(),
	endMonth: integer("end_month").notNull(),
	endYear: integer("end_year").notNull(),
	status: presentationStatusEnum("status").notNull().default("draft"),
	createdBy: text("created_by").notNull().references(() => user.id),
	presentedAt: timestamp("presented_at"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => [
	check("presentations_start_month_range_check", sql`${table.startMonth} between 1 and 12`),
	check("presentations_end_month_range_check", sql`${table.endMonth} between 1 and 12`),
	check(
		"presentations_range_order_check",
		sql`${table.startYear} < ${table.endYear} or (${table.startYear} = ${table.endYear} and ${table.startMonth} <= ${table.endMonth})`,
	),
]);

export const goalSubmissions = pgTable("goal_submissions", {
	id: uuid("id").defaultRandom().primaryKey(),
	presentationId: uuid("presentation_id").notNull().references(() => presentations.id, { onDelete: "cascade" }),
	monthlyGoalId: uuid("monthly_goal_id").notNull().references(() => monthlyGoals.id, { onDelete: "cascade" }),
	submittedValue: decimal("submitted_value", { precision: 12, scale: 2 }).notNull(),
	submittedBy: text("submitted_by").notNull().references(() => user.id),
	submittedAt: timestamp("submitted_at").defaultNow().notNull(),
	notes: text("notes"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
