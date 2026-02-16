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
	busHasta20: decimal("bus_hasta_20", { precision: 10, scale: 2 }),
	bus21a35: decimal("bus_21_a_35", { precision: 10, scale: 2 }),
	busMas35: decimal("bus_mas_35", { precision: 10, scale: 2 }),
});
