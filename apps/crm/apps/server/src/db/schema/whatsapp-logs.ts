import {
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { coDebtors, leads, opportunities } from "./crm";

export const whatsappLogStatusEnum = pgEnum("whatsapp_log_status", [
	"sent",
	"pending",
	"failed",
]);

// Padre: un registro por oportunidad
export const whatsappLogs = pgTable("whatsapp_logs", {
	id: uuid("id").primaryKey().defaultRandom(),
	opportunityId: uuid("opportunity_id")
		.notNull()
		.references(() => opportunities.id, { onDelete: "cascade" }),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Detalle: un registro por destinatario (lead o cofirmante)
export const whatsappLogRecipients = pgTable("whatsapp_log_recipients", {
	id: uuid("id").primaryKey().defaultRandom(),
	whatsappLogId: uuid("whatsapp_log_id")
		.notNull()
		.references(() => whatsappLogs.id, { onDelete: "cascade" }),
	leadId: uuid("lead_id").references(() => leads.id, {
		onDelete: "cascade",
	}),
	coDebtorId: uuid("co_debtor_id").references(() => coDebtors.id, {
		onDelete: "cascade",
	}),
	recipientName: text("recipient_name").notNull(),
	phone: text("phone"),
	message: text("message"),
	contracts:
		jsonb("contracts").$type<
			{ contractName: string; link: string | null; pdfLink?: string | null }[]
		>(),
	status: whatsappLogStatusEnum("status").notNull().default("pending"),
	reason: text("reason"),
	sentAt: timestamp("sent_at"),
	createdAt: timestamp("created_at").defaultNow().notNull(),
	updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
