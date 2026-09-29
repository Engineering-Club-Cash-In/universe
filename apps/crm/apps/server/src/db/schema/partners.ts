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
import { companies, opportunities } from "./crm";
import { vehicleVendors } from "./vehicles";

// Estado exclusivo de autenticación de una cuenta partner. La contraseña
// real la administra Better Auth en `account`; aquí solo registramos si ya
// completó el cambio inicial.
export const partnerAccounts = pgTable("partner_accounts", {
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
	passwordChangedAt: timestamp("password_changed_at"),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Qué agencias/predios puede ver un usuario con rol partner. Con `sellerId`
// ve solo las oportunidades de ese vendedor; sin él (gerente), toda la agencia.
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
		// RESTRICT: borrar al vendedor no puede dejar al usuario como gerente.
		sellerId: uuid("seller_id").references(() => vehicleVendors.id, {
			onDelete: "restrict",
		}),
		createdAt: timestamp("created_at").notNull().defaultNow(),
	},
	(table) => [
		unique("partner_members_user_id_company_id_unique").on(
			table.userId,
			table.companyId,
		),
		index("partner_members_user_id_idx").on(table.userId),
		index("partner_members_seller_id_idx").on(table.sellerId),
	],
);

// Vendedor de agencia de cada oportunidad. Tabla aparte para no sumar
// columnas a `opportunities`; el UNIQUE deja un solo vendedor por oportunidad.
export const opportunityAgencySellers = pgTable(
	"opportunity_agency_sellers",
	{
		id: uuid("id").primaryKey().defaultRandom(),
		opportunityId: uuid("opportunity_id")
			.notNull()
			.references(() => opportunities.id, { onDelete: "cascade" }),
		sellerId: uuid("seller_id")
			.notNull()
			.references(() => vehicleVendors.id, { onDelete: "cascade" }),
		assignedBy: text("assigned_by").references(() => user.id, {
			onDelete: "set null",
		}),
		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
	},
	(table) => [
		unique("opportunity_agency_sellers_opportunity_id_unique").on(
			table.opportunityId,
		),
		index("opportunity_agency_sellers_seller_id_idx").on(table.sellerId),
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
	seller: one(vehicleVendors, {
		fields: [partnerMembers.sellerId],
		references: [vehicleVendors.id],
	}),
}));

export const opportunityAgencySellersRelations = relations(
	opportunityAgencySellers,
	({ one }) => ({
		opportunity: one(opportunities, {
			fields: [opportunityAgencySellers.opportunityId],
			references: [opportunities.id],
		}),
		seller: one(vehicleVendors, {
			fields: [opportunityAgencySellers.sellerId],
			references: [vehicleVendors.id],
		}),
	}),
);

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
export type OpportunityAgencySeller =
	typeof opportunityAgencySellers.$inferSelect;
