import { decimal, integer, pgTable } from "drizzle-orm/pg-core";

export const insuranceCosts = pgTable("insurance_costs", {
	price: integer("price").primaryKey(),
	inrexsa: decimal("inrexsa", { precision: 10, scale: 2 }).notNull(),
	pickUp: decimal("pick_up", { precision: 10, scale: 2 }).notNull(),
	panelCamionMicrobus: decimal("panel_camion_microbus", {
		precision: 10,
		scale: 2,
	}).notNull(),
	membership: decimal("membership", { precision: 10, scale: 2 }).notNull(),
});
