import { relations } from "drizzle-orm";
import {
	index,
	pgTable,
	text,
	timestamp,
	unique,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { companies } from "./crm";

// Qué agencias/predios puede ver un usuario con rol partner.
export const partnerMembers = pgTable(
	"partner_members",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		companyId: uuid("company_id")
			.notNull()
			.references(() => companies.id, { onDelete: "cascade" }),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => [
		unique("partner_members_user_id_company_id_unique").on(
			table.userId,
			table.companyId,
		),
		index("partner_members_user_id_idx").on(table.userId),
	],
);

export const partnerMembersRelations = relations(partnerMembers, ({ one }) => ({
	user: one(user, {
		fields: [partnerMembers.userId],
		references: [user.id],
	}),
	company: one(companies, {
		fields: [partnerMembers.companyId],
		references: [companies.id],
	}),
}));

export type PartnerMember = typeof partnerMembers.$inferSelect;
export type NewPartnerMember = typeof partnerMembers.$inferInsert;
