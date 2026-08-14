import {
	boolean,
	integer,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { coDebtors, leads } from "./crm";

/**
 * Tabla de códigos OTP (One-Time Password) para verificación de leads
 *
 * Un lead puede tener múltiples OTPs a lo largo del tiempo, pero solo
 * el más reciente no expirado es válido.
 *
 * Casos de uso:
 * - Verificación de teléfono al crear lead
 * - Verificación de identidad antes de aprobar crédito
 * - Re-autenticación para acciones sensibles
 */
export const otps = pgTable("otps", {
	/** ID único del OTP */
	id: uuid("id").primaryKey().defaultRandom(),

	/** Código OTP de 6 dígitos */
	code: text("code").notNull(),

	/**
	 * Qué flujo emitió el código: `ventas` (el bot de ventas, vía los endpoints
	 * públicos `/info/*`) o `cobros` (el bot de cobros).
	 *
	 * La validación de cada flujo solo acepta los suyos. Sin esta distinción, un
	 * código pedido por el endpoint público de ventas —que acepta cualquier DPI
	 * y un teléfono elegido por quien llama— servía para entrar al bot de cobros
	 * como esa persona.
	 */
	origen: text("origen").notNull().default("ventas"),

	/**
	 * DPI de quien pidió el código (para búsqueda rápida sin join).
	 *
	 * Nullable desde el bot de cobros: hay clientes con crédito que no tienen
	 * DPI cargado en el CRM y se identifican por placa o NIT.
	 */
	dpi: text("dpi"),

	/**
	 * Referencia al lead que solicitó el OTP.
	 *
	 * Nullable desde el bot de cobros: cuando el DPI buscado es el de un
	 * codeudor, el código se le manda a él y la fila apunta a `coDebtorId` en
	 * lugar de a un lead. Siempre hay uno de los dos (constraint
	 * `otps_destinatario_check`).
	 */
	leadId: uuid("lead_id").references(() => leads.id, { onDelete: "cascade" }),

	/** Referencia al codeudor, cuando el OTP se le envió a él en vez del titular */
	coDebtorId: uuid("co_debtor_id").references(() => coDebtors.id, {
		onDelete: "cascade",
	}),

	/** Teléfono al que se envió el SMS (puede diferir del lead.phone si cambió) */
	phoneNumber: text("phone_number").notNull(),

	/** Fecha y hora de expiración del OTP (típicamente 5-10 minutos después de creado) */
	expiresAt: timestamp("expires_at").notNull(),

	/** Indica si el OTP ya fue usado (un OTP solo puede usarse una vez) */
	used: boolean("used").notNull().default(false),

	/** Fecha y hora en que se usó el OTP (null si no se ha usado) */
	usedAt: timestamp("used_at"),

	/** Número de intentos fallidos de verificación con este OTP */
	attempts: integer("attempts").notNull().default(0),

	/** Fecha y hora de creación */
	createdAt: timestamp("created_at").notNull().defaultNow(),
});
