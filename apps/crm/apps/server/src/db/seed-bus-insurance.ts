import { eq } from "drizzle-orm";
import * as fs from "fs";
import { db } from "./index";
import { insuranceCosts } from "./schema";

async function seedBusInsurance() {
	try {
		console.log("Cargando datos de seguros de bus RCDP desde JSON...");

		const jsonPath = new URL("./bus-insurance-data.json", import.meta.url)
			.pathname;
		const data = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));

		console.log(`Procesando ${data.length} registros de bus...`);

		let updated = 0;
		let inserted = 0;

		for (const item of data) {
			// Intentar actualizar fila existente
			const [existing] = await db
				.select()
				.from(insuranceCosts)
				.where(eq(insuranceCosts.price, item.price))
				.limit(1);

			if (existing) {
				await db
					.update(insuranceCosts)
					.set({
						busHasta20: item.bus_hasta_20.toFixed(2),
						bus21a35: item.bus_21_a_35.toFixed(2),
						busMas35: item.bus_mas_35.toFixed(2),
					})
					.where(eq(insuranceCosts.price, item.price));
				updated++;
			} else {
				// Insertar nueva fila con valores de bus (otros campos en 0)
				await db.insert(insuranceCosts).values({
					price: item.price,
					inrexsa: "0.00",
					pickUp: "0.00",
					panelCamionMicrobus: "0.00",
					membership: "0.00",
					busHasta20: item.bus_hasta_20.toFixed(2),
					bus21a35: item.bus_21_a_35.toFixed(2),
					busMas35: item.bus_mas_35.toFixed(2),
				});
				inserted++;
			}
		}

		console.log(
			`✓ Datos de seguros de bus cargados: ${updated} actualizados, ${inserted} insertados`,
		);
		process.exit(0);
	} catch (error) {
		console.error("Error al cargar datos de seguros de bus:", error);
		process.exit(1);
	}
}

seedBusInsurance();
