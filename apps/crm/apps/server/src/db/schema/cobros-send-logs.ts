import {
	index,
	jsonb,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";

export const cobrosSendCanalEnum = pgEnum("cobros_send_canal", [
	"sms",
	"email",
	"whatsapp",
]);

export const cobrosSendStatusEnum = pgEnum("cobros_send_status", [
	"sent",
	"failed",
]);

/**
 * Log de envíos de mensajes de cobros (SMS / Email / WhatsApp).
 * Un registro por intento de envío, con el contenido enviado y la respuesta
 * del proveedor (SimpleTech / Resend / SMSClient).
 * Se referencia al caso por número SIFCO (no FK dura a casos_cobros).
 */
export const cobrosSendLogs = pgTable(
	"cobros_send_logs",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		// Contexto del caso
		numeroCreditoSifco: text("numero_credito_sifco"),

		// Canal y contenido
		canal: cobrosSendCanalEnum("canal").notNull(),
		telefono: text("telefono"),
		email: text("email"),
		asunto: text("asunto"),
		mensaje: text("mensaje").notNull(),

		// Resultado
		status: cobrosSendStatusEnum("status").notNull(),
		errorMessage: text("error_message"),
		providerResponse: jsonb("provider_response").$type<Record<string, unknown>>(),

		// Auditoría
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id, { onDelete: "restrict" }),
		sentAt: timestamp("sent_at"),
		createdAt: timestamp("created_at").defaultNow().notNull(),
	},
	(t) => [
		index("idx_cobros_send_logs_sifco").on(t.numeroCreditoSifco),
		index("idx_cobros_send_logs_created_at").on(t.createdAt),
	],
);
