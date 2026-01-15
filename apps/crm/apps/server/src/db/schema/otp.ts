import { pgTable, uuid, text, timestamp, boolean, integer } from "drizzle-orm/pg-core";
import { leads } from "./crm";
 

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
	
	/** DPI del lead asociado (para búsqueda rápida sin join) */
	dpi: text("dpi").notNull(),
	
	/** Referencia al lead que solicitó el OTP */
	leadId: uuid("lead_id")
		.notNull()
		.references(() => leads.id, { onDelete: "cascade" }),
	
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