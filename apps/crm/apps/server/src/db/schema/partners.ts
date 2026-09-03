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

// Estado exclusivo de autenticaciÃ³n de una cuenta partner. La contraseÃ±a
// real la administra Better Auth en `account`; aquÃ­ solo registramos si ya
// completÃ³ el cambio inicial.
export const partnerAccounts = pgTable("partner_accounts", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	passwordChangedAt: timestamp("password_changed_at"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

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

export const partnerAccountsRelations = relations(
	partnerAccounts,
	({ one }) => ({
		user: one(user, {
			fields: [partnerAccounts.userId],
			references: [user.id],
		}),
	}),
);

export type PartnerMember = typeof partnerMembers.$inferSelect;
export type NewPartnerMember = typeof partnerMembers.$inferInsert;
export type PartnerAccount = typeof partnerAccounts.$inferSelect;
export type NewPartnerAccount = typeof partnerAccounts.$inferInsert;
