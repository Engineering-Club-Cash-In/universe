import {
	decimal,
	integer,
	pgEnum,
	pgTable,
	text,
	timestamp,
	uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { opportunities } from "./crm";
import { vehicles } from "./vehicles";

export const quotationStatusEnum = pgEnum("quotation_status", [
	"draft",
	"sent",
	"accepted",
	"rejected",
]);

export const vehicleTypeEnum = pgEnum("vehicle_type", [
	"particular",
	"uber",
	"pickup",
	"nuevo",
	"panel",
	"camion",
	"microbus",
]);

export const quotations = pgTable("quotations", {
	id: uuid("id").primaryKey().defaultRandom(),
	createdAt: timestamp("created_at").notNull().defaultNow(),
	updatedAt: timestamp("updated_at").notNull().defaultNow(),

	// Relaciones opcionales
	opportunityId: uuid("opportunity_id").references(() => opportunities.id, {
		onDelete: "set null",
	}),
	vehicleId: uuid("vehicle_id").references(() => vehicles.id, {
		onDelete: "set null",
	}),
	salesUserId: text("sales_user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),

	// Datos del vehículo (pueden ser manuales o del vehículo vinculado)
	vehicleBrand: text("vehicle_brand"),
	vehicleLine: text("vehicle_line"),
	vehicleModel: text("vehicle_model"),
	vehicleType: vehicleTypeEnum("vehicle_type").notNull().default("particular"),
	vehicleValue: decimal("vehicle_value", { precision: 12, scale: 2 }).notNull(),
	insuredAmount: decimal("insured_amount", {
		precision: 12,
		scale: 2,
	}).notNull(),

	// Datos del financiamiento
	downPayment: decimal("down_payment", { precision: 12, scale: 2 }).notNull(),
	downPaymentPercentage: decimal("down_payment_percentage", {
		precision: 5,
		scale: 2,
	}).notNull(),
	termMonths: integer("term_months").notNull(), // plazo en meses
	interestRate: decimal("interest_rate", { precision: 5, scale: 2 }).notNull(), // tasa mensual

	// Costos adicionales
	insuranceCost: decimal("insurance_cost", { precision: 12, scale: 2 })
		.notNull()
		.default("0"),
	gpsCost: decimal("gps_cost", { precision: 12, scale: 2 })
		.notNull()
		.default("0"),
	transferCost: decimal("transfer_cost", { precision: 12, scale: 2 })
		.notNull()
		.default("0"),
	adminCost: decimal("admin_cost", { precision: 12, scale: 2 })
		.notNull()
		.default("0"),
	membershipCost: decimal("membership_cost", { precision: 12, scale: 2 })
		.notNull()
		.default("0"),

	// Comisiones - Free lance
	freelanceCost: decimal("freelance_cost", { precision: 12, scale: 2 }).default(
		"0",
	),
	freelancePercentage: decimal("freelance_percentage", {
		precision: 5,
		scale: 2,
	}),

	// Royalty (4% del monto solicitado)
	royalty: decimal("royalty", { precision: 12, scale: 2 }).default("0"),
	royaltyPercentage: decimal("royalty_percentage", {
		precision: 5,
		scale: 2,
	}).default("4.00"),

	// Gastos adicionales para detalle de crédito
	inspectionCost: decimal("inspection_cost", {
		precision: 12,
		scale: 2,
	}).default("0"), // Inspección
	finesCost: decimal("fines_cost", { precision: 12, scale: 2 }).default("0"), // Multas
	keyCopyCost: decimal("key_copy_cost", { precision: 12, scale: 2 }).default(
		"0",
	), // Copia de llave
	keyCopyDiffCost: decimal("key_copy_diff_cost", {
		precision: 12,
		scale: 2,
	}).default("0"), // Diferencia de copia de llave
	circulationTaxCost: decimal("circulation_tax_cost", {
		precision: 12,
		scale: 2,
	}).default("0"), // Impuesto circulación
	mobileGuaranteeCost: decimal("mobile_guarantee_cost", {
		precision: 12,
		scale: 2,
	}).default("0"), // Garantía mobiliaria
	leasingContractCost: decimal("leasing_contract_cost", {
		precision: 12,
		scale: 2,
	}).default("0"), // Contrato Leasing
	collectionAuthCost: decimal("collection_auth_cost", {
		precision: 12,
		scale: 2,
	}).default("0"), // Auténtica contrato cobranza
	legalCost: decimal("legal_cost", { precision: 12, scale: 2 }).default("0"), // Gastos legales

	// Gastos específicos de Autocompras
	appointmentCost: decimal("appointment_cost", {
		precision: 12,
		scale: 2,
	}).default("0"), // Nombramiento
	addressVerificationCost: decimal("address_verification_cost", {
		precision: 12,
		scale: 2,
	}).default("0"), // Verificación de dirección

	// Valores calculados
	amountToFinance: decimal("amount_to_finance", {
		precision: 12,
		scale: 2,
	}).notNull(), // valor - enganche
	totalFinanced: decimal("total_financed", {
		precision: 12,
		scale: 2,
	}).notNull(), // amount + costos
	monthlyPayment: decimal("monthly_payment", {
		precision: 12,
		scale: 2,
	}).notNull(),

	// Estado
	status: quotationStatusEnum("status").notNull().default("draft"),

	// Notas
	notes: text("notes"),
});
