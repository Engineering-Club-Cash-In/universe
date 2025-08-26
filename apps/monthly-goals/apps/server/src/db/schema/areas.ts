import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { departments } from "./departments";

export const areas = pgTable("areas", {
	id: uuid("id").defaultRandom().primaryKey(),
	name: text("name").notNull(),
	description: text("description"),
	departmentId: uuid("department_id").notNull().references(() => departments.id, { onDelete: "cascade" }),
	leadId: text("lead_id").references(() => user.id),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});