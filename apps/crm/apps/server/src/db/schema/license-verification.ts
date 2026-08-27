import { sql } from "drizzle-orm";
import {
	boolean,
	check,
	decimal,
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
import { coDebtors, leads, opportunities } from "./crm";

// Resultado final de la verificación (criterio de aceptación #4)
export const licenseVerificationResultEnum = pgEnum(
	"license_verification_result",
	[
		"valida", // QR del dominio oficial + código válido + identidad coincide
		"invalida", // Tránsito rechazó el código, o el dominio del QR no es el oficial
		"ilegible", // no se pudo decodificar el QR y/o el código de barras de la foto
		"revision_manual", // se consultó bien, pero la identidad no calza o requiere ojo humano
	],
);

// Verificación de QR/código del reverso de licencia contra vl.transito.gob.gt (Maicon)
export const licenseQrVerifications = pgTable(
	"license_qr_verifications",
	{
		id: uuid("id").primaryKey().defaultRandom(),

		// El análisis puede ser de un lead O de un co-deudor (uno de los dos debe estar presente)
		leadId: uuid("lead_id").references(() => leads.id),
		coDebtorId: uuid("co_debtor_id").references(() => coDebtors.id),
		opportunityId: uuid("opportunity_id").references(() => opportunities.id, {
			onDelete: "set null",
		}),

		// Key en R2 de la foto del reverso usada en esta verificación (license-verifications/{leadId|coDebtorId}/...)
		documentKey: text("document_key"),

		// Lo decodificado de la imagen
		qrRawUrl: text("qr_raw_url"), // https://vl.transito.gob.gt/{token}
		qrDomainValid: boolean("qr_domain_valid").notNull().default(false),
		cardCode: text("card_code"), // valor del barcode Code128 (texto, preserva ceros a la izquierda)

		// Respuesta cruda de la API de Tránsito
		apiResponseCode: integer("api_response_code"), // "codigo" de su respuesta (0 = éxito)
		licenseHolderName: text("license_holder_name"), // nombreCiudadano
		licenseNumber: text("license_number"), // numeroLicencia
		licenseExpiresAt: text("license_expires_at"), // fechaVencimiento (string dd/mm/yyyy tal cual la regresan)
		// Respuesta completa de Tránsito (sin la foto) para no perder campos como estadoLicencia/
		// estadoFol/bloqueo cuyo significado todavía no está mapeado
		rawResponse: jsonb("raw_response"),

		// Verificación de identidad: comparación del nombre (nombreCiudadano) contra el lead/co-deudor
		// (el veredicto final de si coincide o no ya vive en "result", este es el dato crudo)
		identityMatchScore: decimal("identity_match_score", {
			precision: 5,
			scale: 2,
		}), // % de similitud de nombre normalizado (0-100)

		// Resultado final + trazabilidad (criterio de aceptación #5)
		result: licenseVerificationResultEnum("result").notNull(),
		failureReason: text("failure_reason"),

		createdAt: timestamp("created_at").notNull().defaultNow(),
		updatedAt: timestamp("updated_at").notNull().defaultNow(),
		createdBy: text("created_by")
			.notNull()
			.references(() => user.id),
	},
	(table) => [
		index("license_qr_verifications_lead_id_idx").on(table.leadId),
		index("license_qr_verifications_co_debtor_id_idx").on(table.coDebtorId),
		index("license_qr_verifications_opportunity_id_idx").on(
			table.opportunityId,
		),
		index("license_qr_verifications_created_at_idx").on(table.createdAt),
		// A nivel BD, no solo en el refine de zod: exactamente uno de los dos
		// debe estar presente, nunca ambos ni ninguno.
		check(
			"license_qr_verifications_lead_xor_co_debtor",
			sql`num_nonnulls(${table.leadId}, ${table.coDebtorId}) = 1`,
		),
	],
);
