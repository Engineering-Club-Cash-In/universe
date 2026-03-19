import { pgEnum } from "drizzle-orm/pg-core";

/**
 * Shared public enums that already exist in the database because of cartera.
 *
 * CRM doesn't own the related tables, but declaring the enums here prevents
 * drizzle-kit push from treating them as stray public objects to be dropped.
 */
export const paymentValidationStatusEnum = pgEnum(
	"payment_validation_status",
	["no_required", "pending", "validated", "capital", "reset"],
);

export const estadoLiquidacionEnum = pgEnum("estado_liquidacion", [
	"NO_LIQUIDADO",
	"POR_LIQUIDAR",
	"LIQUIDADO",
]);

export const tipoCuentaEnum = pgEnum("tipo_cuenta_enum", [
	"AHORRO",
	"AHORRO Q",
	"AHORROS",
	"AHORRO $",
	"MONETARIA",
	"MONETARIA Q",
	"MONETARIA $",
]);
