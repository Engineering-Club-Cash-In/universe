import { pgTable, text, uuid, timestamp, decimal, integer, pgEnum } from "drizzle-orm/pg-core";
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
	insuredAmount: decimal("insured_amount", { precision: 12, scale: 2 }).notNull(),

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

	// Valores calculados
	amountToFinance: decimal("amount_to_finance", {
		precision: 12,
		scale: 2,
	}).notNull(), // valor - enganche
	totalFinanced: decimal("total_financed", { precision: 12, scale: 2 }).notNull(), // amount + costos
	monthlyPayment: decimal("monthly_payment", { precision: 12, scale: 2 }).notNull(),

	// Estado
	status: quotationStatusEnum("status").notNull().default("draft"),

	// Notas
	notes: text("notes"),
});
