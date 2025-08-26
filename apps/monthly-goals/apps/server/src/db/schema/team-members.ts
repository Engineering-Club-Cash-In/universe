import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { areas } from "./areas";

export const teamMembers = pgTable("team_members", {
	id: uuid("id").defaultRandom().primaryKey(),
	userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
	areaId: uuid("area_id").notNull().references(() => areas.id, { onDelete: "cascade" }),
	position: text("position"),
	joinedAt: timestamp("joined_at").defaultNow().notNull(),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});