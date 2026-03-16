import { jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import type { JuridicoDashboardPayload } from "../../lib/juridico-dashboard-schema";
import { user } from "./auth";

export const juridicoDashboardSnapshots = pgTable(
	"juridico_dashboard_snapshots",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		scope: text("scope").notNull().default("default"),
		periodLabel: text("period_label").notNull(),
		notes: text("notes"),
		payload: jsonb("payload").$type<JuridicoDashboardPayload>().notNull(),
		updatedBy: text("updated_by")
			.notNull()
			.references(() => user.id),
		publishedAt: timestamp("published_at").notNull().defaultNow(),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(table) => [uniqueIndex("juridico_dashboard_scope_unique").on(table.scope)],
);
