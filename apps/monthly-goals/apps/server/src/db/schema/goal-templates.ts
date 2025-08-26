import { pgTable, text, timestamp, uuid, decimal } from "drizzle-orm/pg-core";

export const goalTemplates = pgTable("goal_templates", {
	id: uuid("id").defaultRandom().primaryKey(),
	name: text("name").notNull(),
	description: text("description"),
	defaultTarget: decimal("default_target", { precision: 10, scale: 2 }),
	unit: text("unit"), // 'entregas', 'ventas', 'tickets', etc.
	successThreshold: decimal("success_threshold", { precision: 5, scale: 2 }).notNull().default("80"), // % para verde
	warningThreshold: decimal("warning_threshold", { precision: 5, scale: 2 }).notNull().default("50"), // % para amarillo
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});