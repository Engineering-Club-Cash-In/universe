import { decimal, integer, pgTable } from "drizzle-orm/pg-core";

export const insuranceCosts = pgTable("insurance_costs", {
	price: integer("price").primaryKey(),
	inrexsa: decimal("inrexsa", { precision: 16, scale: 8 }).notNull(),
	pickUp: decimal("pick_up", { precision: 16, scale: 8 }).notNull(),
	panelCamionMicrobus: decimal("panel_camion_microbus", {
		precision: 16,
		scale: 8,
	}).notNull(),
	membership: decimal("membership", { precision: 16, scale: 8 }).notNull(),
	busHasta20: decimal("bus_hasta_20", { precision: 16, scale: 8 }),
	bus21a35: decimal("bus_21_a_35", { precision: 16, scale: 8 }),
	busMas35: decimal("bus_mas_35", { precision: 16, scale: 8 }),
});
