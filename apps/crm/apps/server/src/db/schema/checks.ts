import {
	decimal,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { opportunities } from "./crm";
import { quotations } from "./quotations";

// Tabla para registrar cheques emitidos en el detalle de crédito
export const creditChecks = pgTable("credit_checks", {
	id: uuid("id").primaryKey().defaultRandom(),

	// Relación con oportunidad o cotización
	opportunityId: uuid("opportunity_id").references(() => opportunities.id, {
		onDelete: "cascade",
	}),
	quotationId: uuid("quotation_id").references(() => quotations.id, {
		onDelete: "set null",
	}),

	// Datos del cheque
	checkDate: timestamp("check_date").notNull(),
	issuer: text("issuer").notNull(), // Emisor
	bank: text("bank").notNull(), // Banco
	beneficiary: text("beneficiary").notNull(), // Beneficiario
	concept: text("concept").notNull(), // Concepto
	currency: text("currency").notNull().default("GTQ"), // Moneda (Quetzales por defecto)
	amount: decimal("amount", { precision: 12, scale: 2 }).notNull(), // Monto

	// Metadata
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),
	createdBy: text("created_by")
		.notNull()
		.references(() => user.id),
});

// Export types
export type CreditCheck = typeof creditChecks.$inferSelect;
export type NewCreditCheck = typeof creditChecks.$inferInsert;
