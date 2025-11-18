import { pgTable, text, timestamp, uuid, decimal, integer, pgEnum, unique } from "drizzle-orm/pg-core";
import { teamMembers } from "./team-members";
import { goalTemplates } from "./goal-templates";

export const goalStatusEnum = pgEnum("goal_status", ["pending", "in_progress", "completed"]);

export const monthlyGoals = pgTable("monthly_goals", {
	id: uuid("id").defaultRandom().primaryKey(),
	teamMemberId: uuid("team_member_id").notNull().references(() => teamMembers.id, { onDelete: "cascade" }),
	goalTemplateId: uuid("goal_template_id").notNull().references(() => goalTemplates.id, { onDelete: "cascade" }),
	month: integer("month").notNull(),
	year: integer("year").notNull(),
	targetValue: decimal("target_value", { precision: 10, scale: 2 }).notNull(),
	achievedValue: decimal("achieved_value", { precision: 10, scale: 2 }).notNull().default("0"),
	description: text("description"),
	status: goalStatusEnum("status").notNull().default("pending"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
	uniqueGoal: unique().on(table.teamMemberId, table.goalTemplateId, table.month, table.year),
}));