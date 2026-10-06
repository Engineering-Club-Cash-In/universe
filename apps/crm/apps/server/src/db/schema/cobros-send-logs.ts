import {
	index,
	integer,
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

		// Plantilla seleccionada (whatsapp). Null para envíos ad-hoc (email/sms libres).
		plantillaId: text("plantilla_id"),

		// Agrupador para envíos masivos: todas las filas de un mismo
		// enviarWhatsappMasivoCobros comparten este id. Null para envíos individuales.
		batchId: uuid("batch_id"),

		// Payload exacto enviado al proveedor (templateName, serviceIdentifier, body…)
		// y respuesta cruda completa del proveedor para poder auditar/depurar
		// sin tener que reconstruir nada desde los logs de stdout.
		providerRequest: jsonb("provider_request").$type<Record<string, unknown>>(),
		providerResponse:
			jsonb("provider_response").$type<Record<string, unknown>>(),

		// Resultado
		status: cobrosSendStatusEnum("status").notNull(),
		errorMessage: text("error_message"),

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
		index("idx_cobros_send_logs_batch").on(t.batchId),
	],
);

/**
 * Idempotencia del recibo de pago por WhatsApp (migración 0047): el CRM
 * reserva el `pago_id` antes de llamar a WhatsApp, así un reintento de cartera
 * (respuesta cortada, reinicio) no manda el mismo recibo dos veces.
 */
export const recibosPagoWhatsapp = pgTable("recibos_pago_whatsapp", {
	pagoId: integer("pago_id").primaryKey(),
	numeroCreditoSifco: text("numero_credito_sifco"),
	estado: text("estado").notNull(), // enviando | enviado | fallido
	intentos: integer("intentos").notNull().default(1),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	actualizadoAt: timestamp("actualizado_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});

/**
 * Reserva de la bienvenida AUTOMÁTICA por crédito (migración 0048): el
 * disparo del cierre al 90% y el barrido de recuperación la toman antes de
 * llamar a WhatsApp, así dos procesos no la mandan dos veces. El envío manual
 * de la plantilla no la usa.
 */
export const bienvenidasCredito = pgTable("bienvenidas_credito", {
	numeroCreditoSifco: text("numero_credito_sifco").primaryKey(),
	estado: text("estado").notNull(), // enviando | enviada | fallida
	intentos: integer("intentos").notNull().default(1),
	createdAt: timestamp("created_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
	actualizadoAt: timestamp("actualizado_at", { withTimezone: true })
		.notNull()
		.defaultNow(),
});
